"""Durable, privacy-safe entitlement and paid AI usage records.

The usage ledger deliberately stores only operation metadata and a one-way
idempotency-key digest. It must never become a second store for meal photos,
model prompts, or nutrition content.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class AiEntitlement(Base):
    __tablename__ = "ai_entitlements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    # Billing providers can later map their product state onto these stable,
    # product-owned tiers without rewriting historical usage records.
    tier: Mapped[str] = mapped_column(String(24), default="free")
    status: Mapped[str] = mapped_column(String(24), default="active")
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AiUsageRecord(Base):
    __tablename__ = "ai_usage_records"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "operation",
            "idempotency_key_hash",
            name="uq_ai_usage_user_operation_idempotency_key",
        ),
        Index("ix_ai_usage_user_operation_reserved", "user_id", "operation", "reserved_at"),
        Index("ix_ai_usage_status_expires", "status", "reservation_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    operation: Mapped[str] = mapped_column(String(96), index=True)
    entitlement_tier: Mapped[str] = mapped_column(String(24))
    # A digest lets retries be reconciled without retaining the client-provided key.
    idempotency_key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    units: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), index=True, default="reserved")
    reservation_attempts: Mapped[int] = mapped_column(Integer, default=1)
    refund_count: Mapped[int] = mapped_column(Integer, default=0)
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reservation_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refund_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
