from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.food import json_variant


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_analysis_jobs_user_idempotency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    meal_summary: Mapped[str | None] = mapped_column(String(512), nullable=True)
    warnings_json: Mapped[list[str]] = mapped_column(json_variant, default=list)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Links durable job execution to its privacy-safe quota reservation. The
    # worker never needs a raw idempotency key or image bytes to settle/refund.
    ai_usage_record_id: Mapped[str | None] = mapped_column(
        ForeignKey("ai_usage_records.id", ondelete="SET NULL"), nullable=True, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_payload_json: Mapped[dict] = mapped_column(json_variant, default=dict)
    result_json: Mapped[dict | None] = mapped_column(json_variant, nullable=True)
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    reference_plate_diameter_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AnalysisJobItem(Base):
    __tablename__ = "analysis_job_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    analysis_job_id: Mapped[str] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    temporary_id: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(256))
    candidate_labels: Mapped[list[str]] = mapped_column(json_variant, default=list)
    identity_confidence: Mapped[float] = mapped_column(Float)
    estimated_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    portion_range_min_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    portion_range_max_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    portion_confidence: Mapped[float] = mapped_column(Float)
    visible_preparation: Mapped[str | None] = mapped_column(String(128), nullable=True)
    possible_hidden_ingredients: Mapped[list[str]] = mapped_column(json_variant, default=list)
    requires_confirmation: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AnalysisJobImage(Base):
    """Private, normalized analysis input retained only while a job needs it."""

    __tablename__ = "analysis_job_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    analysis_job_id: Mapped[str] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        index=True,
    )
    storage_key: Mapped[str] = mapped_column(String(512))
    capture_angle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_type: Mapped[str] = mapped_column(String(128), default="image/jpeg")
    retention_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deletion_attempts: Mapped[int] = mapped_column(Integer, default=0)
    deletion_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DataCorrectionReport(Base):
    __tablename__ = "data_correction_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    food_source_record_id: Mapped[str | None] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    meal_item_id: Mapped[str | None] = mapped_column(
        ForeignKey("meal_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    report_type: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="open")
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("food_source_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DataCorrectionReportStatusEvent(Base):
    """An attributable correction-report transition with separate safe/internal text."""

    __tablename__ = "data_correction_report_status_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    correction_report_id: Mapped[str] = mapped_column(
        ForeignKey("data_correction_reports.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), index=True)
    # This text is safe for the reporter to see. Staff-only context stays
    # separate so it is never accidentally included in owner-facing schemas.
    user_visible_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("food_source_revisions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
