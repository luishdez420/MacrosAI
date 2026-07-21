"""Bounded retention cleanup for privacy-minimized operational audit events."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.user import AuditDelivery, AuditLog


def expire_audit_logs(
    db: Session,
    *,
    retention_days: int,
    now: datetime | None = None,
    limit: int = 500,
) -> int:
    """Delete one bounded oldest-first batch after the configured retention window.

    The caller owns the transaction so an operational worker can combine this
    with its other lifecycle work and safely retry a failed sweep. Audit rows
    hold only minimal metadata; their linked account may already be anonymized.
    """

    cutoff = (now or datetime.now(UTC)) - timedelta(days=retention_days)
    ids = list(
        db.scalars(
            select(AuditLog.id)
            .join(AuditDelivery, AuditDelivery.audit_log_id == AuditLog.id)
            .where(AuditLog.created_at < cutoff)
            .where(AuditDelivery.status == "delivered")
            .order_by(AuditLog.created_at.asc(), AuditLog.id.asc())
            .limit(limit)
        ).all()
    )
    if not ids:
        return 0

    db.execute(delete(AuditLog).where(AuditLog.id.in_(ids)))
    return len(ids)
