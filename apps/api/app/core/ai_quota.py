"""Entitlement, reservation, and refund policy for paid AI operations.

This module runs before any image bytes reach an AI provider. It keeps the
accounting boundary durable and deliberately excludes nutrition/image payloads.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.usage import AiEntitlement, AiUsageRecord

AI_USAGE_RESERVED = "reserved"
AI_USAGE_SETTLED = "settled"
AI_USAGE_REFUNDED = "refunded"
AI_USAGE_EXPIRED = "expired"
AI_OPERATION_MEAL_ANALYSIS = "meal-analysis.create"
AI_OPERATION_LABEL_ANALYSIS = "nutrition-label-analysis.create"


class AiQuotaExceededError(Exception):
    """A safe, user-actionable quota denial without exposing account policy."""

    def __init__(self, *, retry_after_seconds: int, remaining: int = 0) -> None:
        super().__init__("Your analysis allowance is currently used. Please try again later.")
        self.retry_after_seconds = retry_after_seconds
        self.remaining = remaining


@dataclass(frozen=True)
class AiQuotaStatus:
    remaining_operations: int | None
    remaining_images: int | None
    remaining_concurrent: int | None
    window_ends_at: datetime

    @property
    def safe_remaining(self) -> int | None:
        # A transient active-request slot is not a spent allowance. Keep it out
        # of user-facing remaining-credit messaging while enforcing it below.
        values = [value for value in (self.remaining_operations, self.remaining_images) if value is not None]
        return min(values) if values else None


@dataclass(frozen=True)
class AiUsageReservation:
    record: AiUsageRecord
    quota: AiQuotaStatus


def reserve_ai_usage(
    db: Session,
    *,
    user_id: str,
    operation: str,
    units: int,
    idempotency_key: str | None,
) -> AiUsageReservation:
    """Atomically reserve AI capacity before dispatching provider work.

    PostgreSQL locks the entitlement row for the short decision transaction,
    serializing quota checks per account. SQLite preview remains functional but
    does not claim cross-process concurrency guarantees.
    """

    if units < 1:
        raise ValueError("AI usage units must be positive.")

    now = datetime.now(UTC)
    entitlement = get_or_create_entitlement(db, user_id)
    tier = effective_tier(entitlement, now)
    if entitlement.status != "active" or tier == "disabled":
        raise AiQuotaExceededError(retry_after_seconds=settings.ai_quota_window_days * 86_400)

    reconcile_expired_reservations(db, user_id=user_id, now=now)
    key_hash = digest_idempotency_key(idempotency_key)
    existing = get_usage_record(db, user_id=user_id, operation=operation, key_hash=key_hash)
    if existing:
        if existing.status == AI_USAGE_SETTLED:
            # The matching idempotency response should normally have replayed
            # before this point. Never silently dispatch paid work a second time.
            raise AiQuotaExceededError(retry_after_seconds=seconds_until_window_end(now), remaining=0)
        existing_deadline = as_utc(existing.reservation_expires_at)
        if existing.status == AI_USAGE_RESERVED and existing_deadline > now:
            raise AiQuotaExceededError(
                retry_after_seconds=max(1, int((existing_deadline - now).total_seconds())),
                remaining=0,
            )
        existing.status = AI_USAGE_RESERVED
        existing.units = units
        existing.entitlement_tier = tier
        existing.reservation_attempts += 1
        existing.reserved_at = now
        existing.reservation_expires_at = reservation_deadline(now)
        existing.settled_at = None
        existing.refunded_at = None
        existing.refund_reason = None
        db.flush()
        return AiUsageReservation(existing, quota_status(db, user_id=user_id, operation=operation, tier=tier, now=now))

    status = quota_status(db, user_id=user_id, operation=operation, tier=tier, now=now)
    if status.remaining_concurrent is not None and status.remaining_concurrent < 1:
        raise AiQuotaExceededError(retry_after_seconds=settings.ai_quota_reservation_ttl_seconds, remaining=0)
    if not allowance_can_cover(status, units=units, operation=operation):
        raise AiQuotaExceededError(
            retry_after_seconds=seconds_until_window_end(now),
            remaining=status.safe_remaining or 0,
        )

    record = AiUsageRecord(
        user_id=user_id,
        operation=operation,
        entitlement_tier=tier,
        idempotency_key_hash=key_hash,
        units=units,
        status=AI_USAGE_RESERVED,
        reserved_at=now,
        reservation_expires_at=reservation_deadline(now),
    )
    db.add(record)
    db.flush()
    return AiUsageReservation(record, quota_status(db, user_id=user_id, operation=operation, tier=tier, now=now))


def settle_ai_usage(db: Session, reservation: AiUsageReservation) -> None:
    record = reservation.record
    if record.status != AI_USAGE_RESERVED:
        return
    record.status = AI_USAGE_SETTLED
    record.settled_at = datetime.now(UTC)
    record.reservation_expires_at = record.settled_at
    db.flush()


def refund_ai_usage(db: Session, reservation: AiUsageReservation, *, reason: str) -> None:
    """Refund only system/provider failures after a usage reservation exists."""

    record = reservation.record
    if record.status != AI_USAGE_RESERVED:
        return
    record.status = AI_USAGE_REFUNDED
    record.refunded_at = datetime.now(UTC)
    record.refund_reason = reason[:64]
    record.refund_count += 1
    record.reservation_expires_at = record.refunded_at
    db.flush()


def settle_ai_usage_record(db: Session, *, record_id: str | None) -> None:
    """Settle a durable job's reservation without retaining its request key."""

    if not record_id:
        return
    record = db.get(AiUsageRecord, record_id)
    if not record or record.status != AI_USAGE_RESERVED:
        return
    record.status = AI_USAGE_SETTLED
    record.settled_at = datetime.now(UTC)
    record.reservation_expires_at = record.settled_at
    db.flush()


def refund_ai_usage_record(db: Session, *, record_id: str | None, reason: str) -> None:
    """Refund a durable job reservation when no analysis result can be used."""

    if not record_id:
        return
    record = db.get(AiUsageRecord, record_id)
    if not record or record.status != AI_USAGE_RESERVED:
        return
    record.status = AI_USAGE_REFUNDED
    record.refunded_at = datetime.now(UTC)
    record.refund_reason = reason[:64]
    record.refund_count += 1
    record.reservation_expires_at = record.refunded_at
    db.flush()


def renew_ai_usage_record(db: Session, *, record_id: str | None) -> bool:
    """Re-check a queued durable job before it reaches a paid provider.

    A worker can recover after the original short reservation has expired. This
    atomically renews that same ledger record instead of sending an unaccounted
    provider request, or returns ``False`` when the allowance no longer covers
    the job.
    """

    if not record_id:
        return False
    record = db.scalar(select(AiUsageRecord).where(AiUsageRecord.id == record_id).with_for_update())
    if not record:
        return False
    now = datetime.now(UTC)
    if record.status == AI_USAGE_RESERVED and as_utc(record.reservation_expires_at) > now:
        return True
    if record.status in {AI_USAGE_SETTLED, AI_USAGE_REFUNDED}:
        return False

    entitlement = get_or_create_entitlement(db, record.user_id)
    tier = effective_tier(entitlement, now)
    if entitlement.status != "active" or tier == "disabled":
        return False
    reconcile_expired_reservations(db, user_id=record.user_id, now=now)
    status = quota_status(db, user_id=record.user_id, operation=record.operation, tier=tier, now=now)
    if status.remaining_concurrent is not None and status.remaining_concurrent < 1:
        return False
    if not allowance_can_cover(status, units=record.units, operation=record.operation):
        return False

    record.status = AI_USAGE_RESERVED
    record.entitlement_tier = tier
    record.reservation_attempts += 1
    record.reserved_at = now
    record.reservation_expires_at = reservation_deadline(now)
    record.settled_at = None
    record.refunded_at = None
    record.refund_reason = None
    db.flush()
    return True


def quota_status(
    db: Session,
    *,
    user_id: str,
    operation: str,
    tier: str,
    now: datetime,
) -> AiQuotaStatus:
    window_start = now - timedelta(days=settings.ai_quota_window_days)
    window_end = now + timedelta(days=settings.ai_quota_window_days)
    used = int(
        db.scalar(
            select(func.coalesce(func.sum(AiUsageRecord.units), 0)).where(
                AiUsageRecord.user_id == user_id,
                AiUsageRecord.operation == operation,
                AiUsageRecord.status.in_((AI_USAGE_RESERVED, AI_USAGE_SETTLED)),
                AiUsageRecord.reserved_at >= window_start,
            )
        )
        or 0
    )
    used_images = int(
        db.scalar(
            select(func.coalesce(func.sum(AiUsageRecord.units), 0)).where(
                AiUsageRecord.user_id == user_id,
                AiUsageRecord.operation == AI_OPERATION_MEAL_ANALYSIS,
                AiUsageRecord.status.in_((AI_USAGE_RESERVED, AI_USAGE_SETTLED)),
                AiUsageRecord.reserved_at >= window_start,
            )
        )
        or 0
    )
    concurrent = int(
        db.scalar(
            select(func.count()).select_from(AiUsageRecord).where(
                AiUsageRecord.user_id == user_id,
                AiUsageRecord.status == AI_USAGE_RESERVED,
                AiUsageRecord.reservation_expires_at > now,
            )
        )
        or 0
    )
    operation_limit = operation_limit_for(tier, operation)
    image_limit = image_limit_for(tier) if operation == AI_OPERATION_MEAL_ANALYSIS else None
    concurrent_limit = concurrent_limit_for(tier)
    return AiQuotaStatus(
        remaining_operations=remaining(operation_limit, used),
        remaining_images=remaining(image_limit, used_images),
        remaining_concurrent=remaining(concurrent_limit, concurrent),
        window_ends_at=window_end,
    )


def get_or_create_entitlement(db: Session, user_id: str) -> AiEntitlement:
    entitlement = db.scalar(select(AiEntitlement).where(AiEntitlement.user_id == user_id).with_for_update())
    if entitlement:
        return entitlement
    entitlement = AiEntitlement(user_id=user_id)
    db.add(entitlement)
    db.flush()
    return entitlement


def reconcile_expired_reservations(db: Session, *, user_id: str, now: datetime) -> int:
    result = db.execute(
        update(AiUsageRecord)
        .where(
            AiUsageRecord.user_id == user_id,
            AiUsageRecord.status == AI_USAGE_RESERVED,
            AiUsageRecord.reservation_expires_at <= now,
        )
        .values(status=AI_USAGE_EXPIRED, refund_reason="reservation_expired")
        .execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


def quota_response_headers(status: AiQuotaStatus) -> dict[str, str]:
    headers = {"X-AI-Quota-Window-Ends": status.window_ends_at.isoformat()}
    if status.safe_remaining is not None:
        headers["X-AI-Quota-Remaining"] = str(max(0, status.safe_remaining))
    return headers


def allowance_can_cover(status: AiQuotaStatus, *, units: int, operation: str) -> bool:
    if status.remaining_operations is not None and status.remaining_operations < units:
        return False
    if operation == AI_OPERATION_MEAL_ANALYSIS and status.remaining_images is not None and status.remaining_images < units:
        return False
    return True


def effective_tier(entitlement: AiEntitlement, now: datetime) -> str:
    if entitlement.tier == "trial" and entitlement.trial_ends_at and entitlement.trial_ends_at <= now:
        return "free"
    return entitlement.tier


def operation_limit_for(tier: str, operation: str) -> int | None:
    if tier == "internal":
        return None
    if operation == AI_OPERATION_MEAL_ANALYSIS:
        return tier_setting(tier, "meal_analysis")
    if operation == AI_OPERATION_LABEL_ANALYSIS:
        return tier_setting(tier, "label_analysis")
    return 0


def image_limit_for(tier: str) -> int | None:
    if tier == "internal":
        return None
    return tier_setting(tier, "images")


def concurrent_limit_for(tier: str) -> int | None:
    if tier == "internal":
        return None
    return tier_setting(tier, "concurrent")


def tier_setting(tier: str, category: str) -> int:
    normalized = tier if tier in {"free", "trial", "paid"} else "disabled"
    return int(getattr(settings, f"ai_quota_{normalized}_{category}_limit"))


def remaining(limit: int | None, used: int) -> int | None:
    return None if limit is None else max(0, limit - used)


def digest_idempotency_key(value: str | None) -> str | None:
    return hashlib.sha256(value.encode("utf-8")).hexdigest() if value else None


def get_usage_record(db: Session, *, user_id: str, operation: str, key_hash: str | None) -> AiUsageRecord | None:
    if not key_hash:
        return None
    return db.scalar(
        select(AiUsageRecord)
        .where(
            AiUsageRecord.user_id == user_id,
            AiUsageRecord.operation == operation,
            AiUsageRecord.idempotency_key_hash == key_hash,
        )
        .with_for_update()
    )


def reservation_deadline(now: datetime) -> datetime:
    return now + timedelta(seconds=settings.ai_quota_reservation_ttl_seconds)


def seconds_until_window_end(now: datetime) -> int:
    return max(1, settings.ai_quota_window_days * 86_400)


def as_utc(value: datetime) -> datetime:
    """SQLite preview can return naive timestamps despite timezone columns."""

    return value if value.tzinfo else value.replace(tzinfo=UTC)
