from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.audit import record_audit_event
from app.core.config import settings
from app.db.base import Base
from app.models.user import AuditDelivery, AuditLog, User
from app.services.audit_delivery import (
    DELIVERED,
    RETRYING,
    AuditDeliveryEnvelope,
    AuditDeliveryError,
    WebhookAuditDeliverySink,
    deliver_pending_audit_events,
)
from app.services.audit_lifecycle import expire_audit_logs


class RecordingSink:
    def __init__(self) -> None:
        self.envelopes: list[AuditDeliveryEnvelope] = []

    def deliver(self, envelope: AuditDeliveryEnvelope) -> None:
        self.envelopes.append(envelope)


class FailingSink:
    def deliver(self, _envelope: AuditDeliveryEnvelope) -> None:
        raise AuditDeliveryError("receiver_unavailable")


def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_audit_delivery_uses_an_outbox_and_excludes_account_or_client_identity() -> None:
    db = session()
    user = User(email="audit-delivery@example.test")
    db.add(user)
    db.flush()
    event = record_audit_event(
        db,
        event_type="user_data.export",
        user_id=user.id,
        outcome="success",
    )
    db.commit()

    sink = RecordingSink()
    assert deliver_pending_audit_events(db, sink=sink) == (1, 0)

    assert len(sink.envelopes) == 1
    payload = sink.envelopes[0].payload()
    assert payload["eventId"] == event.id
    assert payload["eventType"] == "user_data.export"
    assert payload["outcome"] == "success"
    serialized = json.dumps(payload)
    assert user.id not in serialized
    assert "clientFingerprint" not in serialized
    assert "userId" not in serialized

    delivery = db.scalar(select(AuditDelivery).where(AuditDelivery.audit_log_id == event.id))
    assert delivery is not None
    assert delivery.status == DELIVERED
    assert delivery.delivered_at is not None
    assert delivery.attempts == 1


def test_audit_delivery_retries_with_bounded_backoff_and_retention_waits_for_delivery(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "audit_delivery_retry_base_seconds", 30)
    monkeypatch.setattr(settings, "audit_delivery_retry_max_seconds", 120)
    db = session()
    now = datetime.now(UTC)
    event = AuditLog(event_type="auth.login", created_at=now - timedelta(days=31))
    db.add(event)
    db.flush()
    event_id = event.id
    db.add(AuditDelivery(audit_log_id=event.id))
    db.commit()

    assert deliver_pending_audit_events(db, sink=FailingSink(), now=now) == (0, 1)
    delivery = db.scalar(select(AuditDelivery).where(AuditDelivery.audit_log_id == event.id))
    assert delivery is not None
    assert delivery.status == RETRYING
    assert delivery.attempts == 1
    assert delivery.last_error_code == "receiver_unavailable"
    assert delivery.next_attempt_at is not None
    assert delivery.next_attempt_at.replace(tzinfo=UTC) == now + timedelta(seconds=30)
    assert expire_audit_logs(db, retention_days=30, now=now) == 0

    sink = RecordingSink()
    assert deliver_pending_audit_events(db, sink=sink, now=now + timedelta(seconds=29)) == (0, 0)
    assert deliver_pending_audit_events(db, sink=sink, now=now + timedelta(seconds=30)) == (1, 0)
    assert expire_audit_logs(db, retention_days=30, now=now + timedelta(seconds=30)) == 1
    assert db.get(AuditLog, event_id) is None


def test_webhook_delivery_signs_a_canonical_minimal_envelope(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        captured["url"] = url
        captured.update(kwargs)
        return httpx.Response(204)

    monkeypatch.setattr("app.services.audit_delivery.httpx.post", fake_post)
    secret = "audit-delivery-secret-that-is-longer-than-thirty-two-characters"
    envelope = AuditDeliveryEnvelope(
        audit_log_id="event-1",
        event_type="auth.logout",
        outcome="success",
        request_id="request-1",
        occurred_at=datetime(2026, 7, 21, 12, 0, tzinfo=UTC),
    )

    WebhookAuditDeliverySink(
        url="https://audit.example.test/events",
        hmac_secret=secret,
        timeout_seconds=5,
    ).deliver(envelope)

    expected_body = json.dumps(envelope.payload(), separators=(",", ":"), sort_keys=True).encode("utf-8")
    headers = captured["headers"]
    assert captured["url"] == "https://audit.example.test/events"
    assert captured["content"] == expected_body
    assert isinstance(headers, dict)
    expected_signature = hmac.new(secret.encode("utf-8"), expected_body, hashlib.sha256).hexdigest()
    assert headers["X-Living-Nutrition-Audit-Signature"] == f"sha256={expected_signature}"
    assert "userId" not in expected_body.decode("utf-8")
