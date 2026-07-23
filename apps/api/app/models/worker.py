"""Privacy-safe liveness records for independently deployed workers."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class WorkerHeartbeat(Base):
    """One current liveness row per worker process.

    The instance identifier is an ephemeral random process identifier, not a
    hostname, device identifier, user identifier, or request value. Readiness
    exposes only aggregate worker-type status.
    """

    __tablename__ = "worker_heartbeats"
    __table_args__ = (
        UniqueConstraint("worker_name", "instance_id", name="uq_worker_heartbeats_name_instance"),
        Index("ix_worker_heartbeats_name_last_seen", "worker_name", "last_seen_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    worker_name: Mapped[str] = mapped_column(String(64), index=True)
    instance_id: Mapped[str] = mapped_column(String(36))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
