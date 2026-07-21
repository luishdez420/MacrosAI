"""Retry-safe delivery of privacy-minimized audit envelopes.

The API writes an outbox row with each audit event. A worker later sends a
signed envelope to a deployment-managed append-only receiver. The receiver is
responsible for its immutable/WORM storage policy; this service deliberately
does not send user identifiers, client fingerprints, credentials, food data,
or request bodies.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

import httpx
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import AuditDelivery, AuditLog

AUDIT_ENVELOPE_VERSION = "living-nutrition-audit/v1"
PENDING = "pending"
DELIVERING = "delivering"
RETRYING = "retrying"
DELIVERED = "delivered"


@dataclass(frozen=True)
class AuditDeliveryEnvelope:
    """The complete external payload contract, intentionally without user data."""

    audit_log_id: str
    event_type: str
    outcome: str
    request_id: str | None
    occurred_at: datetime

    def payload(self) -> dict[str, str | None]:
        occurred_at = self.occurred_at
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=UTC)
        return {
            "schemaVersion": AUDIT_ENVELOPE_VERSION,
            "eventId": self.audit_log_id,
            "eventType": self.event_type,
            "outcome": self.outcome,
            "requestId": self.request_id,
            "occurredAt": occurred_at.astimezone(UTC).isoformat(),
        }


class AuditDeliverySink(Protocol):
    """A deployment-owned external destination for append-only audit envelopes."""

    def deliver(self, envelope: AuditDeliveryEnvelope) -> None: ...


class AuditDeliveryError(RuntimeError):
    """A safe category for an external audit receiver failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WebhookAuditDeliverySink:
    """HTTPS JSON webhook with a replay-detectable HMAC signature."""

    def __init__(self, *, url: str, hmac_secret: str, timeout_seconds: float) -> None:
        self._url = url
        self._secret = hmac_secret.encode("utf-8")
        self._timeout_seconds = timeout_seconds

    def deliver(self, envelope: AuditDeliveryEnvelope) -> None:
        payload_bytes = json.dumps(
            envelope.payload(), separators=(",", ":"), sort_keys=True
        ).encode("utf-8")
        signature = hmac.new(self._secret, payload_bytes, hashlib.sha256).hexdigest()
        try:
            response = httpx.post(
                self._url,
                content=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "living-nutrition-audit-delivery/1",
                    "X-Living-Nutrition-Audit-Version": AUDIT_ENVELOPE_VERSION,
                    "X-Living-Nutrition-Audit-Event-Id": envelope.audit_log_id,
                    "X-Living-Nutrition-Audit-Signature": f"sha256={signature}",
                },
                timeout=self._timeout_seconds,
                follow_redirects=False,
            )
        except httpx.TimeoutException as exc:
            raise AuditDeliveryError("timeout") from exc
        except httpx.HTTPError as exc:
            raise AuditDeliveryError("transport_error") from exc

        if 200 <= response.status_code < 300:
            return
        if 400 <= response.status_code < 500:
            raise AuditDeliveryError("receiver_rejected")
        raise AuditDeliveryError("receiver_unavailable")


def build_audit_delivery_sink() -> AuditDeliverySink | None:
    """Return no sink for local preview; production validation requires webhook."""

    if settings.audit_delivery_backend == "disabled":
        return None
    if not settings.audit_delivery_webhook_url or not settings.audit_delivery_hmac_secret:
        raise RuntimeError("Audit delivery webhook settings are incomplete.")
    return WebhookAuditDeliverySink(
        url=str(settings.audit_delivery_webhook_url),
        hmac_secret=settings.audit_delivery_hmac_secret,
        timeout_seconds=settings.audit_delivery_timeout_seconds,
    )


def claim_next_audit_delivery(
    db: Session,
    *,
    now: datetime | None = None,
    lease_seconds: int | None = None,
) -> AuditDeliveryEnvelope | None:
    """Atomically lease one due outbox row before any external network call."""

    timestamp = now or datetime.now(UTC)
    lease_until = timestamp + timedelta(
        seconds=settings.audit_delivery_lease_seconds if lease_seconds is None else lease_seconds
    )
    due = or_(
        and_(
            AuditDelivery.status.in_((PENDING, RETRYING)),
            or_(AuditDelivery.next_attempt_at.is_(None), AuditDelivery.next_attempt_at <= timestamp),
        ),
        and_(
            AuditDelivery.status == DELIVERING,
            AuditDelivery.lease_expires_at.is_not(None),
            AuditDelivery.lease_expires_at <= timestamp,
        ),
    )
    delivery = db.scalar(
        select(AuditDelivery)
        .join(AuditLog, AuditLog.id == AuditDelivery.audit_log_id)
        .where(due)
        .order_by(AuditDelivery.created_at.asc(), AuditDelivery.id.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if not delivery:
        return None

    event = db.get(AuditLog, delivery.audit_log_id)
    if not event:
        # The foreign key normally prevents this. Marking it delivered avoids a
        # poison loop if a legacy database was manually repaired incorrectly.
        delivery.status = DELIVERED
        delivery.delivered_at = timestamp
        delivery.lease_expires_at = None
        db.commit()
        return None

    delivery.status = DELIVERING
    delivery.attempts += 1
    delivery.lease_expires_at = lease_until
    delivery.next_attempt_at = None
    delivery.last_error_code = None
    db.commit()
    return AuditDeliveryEnvelope(
        audit_log_id=event.id,
        event_type=event.event_type,
        outcome=event.outcome,
        request_id=event.request_id,
        occurred_at=event.created_at or timestamp,
    )


def mark_audit_delivery_succeeded(
    db: Session,
    *,
    audit_log_id: str,
    now: datetime | None = None,
) -> None:
    delivery = db.scalar(select(AuditDelivery).where(AuditDelivery.audit_log_id == audit_log_id))
    if not delivery:
        return
    delivery.status = DELIVERED
    delivery.delivered_at = now or datetime.now(UTC)
    delivery.lease_expires_at = None
    delivery.next_attempt_at = None
    delivery.last_error_code = None
    db.commit()


def mark_audit_delivery_failed(
    db: Session,
    *,
    audit_log_id: str,
    error_code: str,
    now: datetime | None = None,
) -> None:
    """Schedule a bounded retry without retaining an external error message."""

    delivery = db.scalar(select(AuditDelivery).where(AuditDelivery.audit_log_id == audit_log_id))
    if not delivery:
        return
    timestamp = now or datetime.now(UTC)
    delay = retry_delay_seconds(delivery.attempts)
    delivery.status = RETRYING
    delivery.lease_expires_at = None
    delivery.next_attempt_at = timestamp + timedelta(seconds=delay)
    delivery.last_error_code = error_code
    db.commit()


def retry_delay_seconds(attempts: int) -> int:
    """Keep delivery retries bounded, deterministic, and independent of event data."""

    exponent = max(0, min(max(attempts, 1) - 1, 20))
    return min(
        settings.audit_delivery_retry_max_seconds,
        settings.audit_delivery_retry_base_seconds * (2**exponent),
    )


def deliver_pending_audit_events(
    db: Session,
    *,
    sink: AuditDeliverySink,
    limit: int = 100,
    now: datetime | None = None,
) -> tuple[int, int]:
    """Deliver a bounded batch and return ``(delivered, retried)`` counts."""

    delivered = 0
    retried = 0
    for _ in range(limit):
        envelope = claim_next_audit_delivery(db, now=now)
        if not envelope:
            break
        try:
            sink.deliver(envelope)
        except AuditDeliveryError as exc:
            mark_audit_delivery_failed(
                db,
                audit_log_id=envelope.audit_log_id,
                error_code=exc.code,
                now=now,
            )
            retried += 1
        except Exception:
            mark_audit_delivery_failed(
                db,
                audit_log_id=envelope.audit_log_id,
                error_code="unexpected_delivery_error",
                now=now,
            )
            retried += 1
        else:
            mark_audit_delivery_succeeded(db, audit_log_id=envelope.audit_log_id, now=now)
            delivered += 1
    return delivered, retried
