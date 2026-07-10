from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint
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
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
