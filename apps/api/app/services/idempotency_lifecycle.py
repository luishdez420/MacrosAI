"""Bounded lifecycle cleanup for short-lived idempotency replay records."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.idempotency import IdempotencyRecord


def expire_idempotency_records(
    db: Session,
    *,
    now: datetime | None = None,
    limit: int = 500,
) -> int:
    """Delete one oldest-first batch of records after their replay window.

    The caller owns the transaction so the retention worker can safely retry a
    failed sweep. Expired pending records are safe to remove because request
    paths already treat their lease as reclaimable after the same deadline.
    """

    cutoff = now or datetime.now(UTC)
    ids = list(
        db.scalars(
            select(IdempotencyRecord.id)
            .where(IdempotencyRecord.expires_at <= cutoff)
            .order_by(IdempotencyRecord.expires_at.asc(), IdempotencyRecord.id.asc())
            .limit(limit)
        ).all()
    )
    if not ids:
        return 0

    db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.id.in_(ids)))
    return len(ids)
