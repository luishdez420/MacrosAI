from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

json_variant = JSON().with_variant(JSONB, "postgresql")


class FoodSourceRecord(Base):
    __tablename__ = "food_source_records"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_food_source_records_provider_external"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    provider: Mapped[str] = mapped_column(String(64), index=True)
    external_id: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str] = mapped_column(String(512))
    data_type: Mapped[str] = mapped_column(String(128))
    brand_owner: Mapped[str | None] = mapped_column(String(256), nullable=True)
    publication_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    nutrients_per_100g: Mapped[dict] = mapped_column(json_variant)
    serving_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_size_unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    household_serving_text: Mapped[str | None] = mapped_column(String(256), nullable=True)
    original_nutrient_ids: Mapped[dict] = mapped_column(json_variant, default=dict)
    quality_flags: Mapped[list[str]] = mapped_column(json_variant, default=list)
    source_reference: Mapped[str] = mapped_column(String(512))
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Provider data remains readable while a stale refresh is leased or backed off.
    # These fields coordinate refresh attempts across API replicas without storing
    # a food query, barcode, or any user data.
    refresh_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refresh_not_before: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        index=True,
        nullable=True,
    )
    refresh_failure_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class FoodSourceRevision(Base):
    """A provider-record snapshot retained only when normalized source data changes."""

    __tablename__ = "food_source_revisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    display_name: Mapped[str] = mapped_column(String(512))
    data_type: Mapped[str] = mapped_column(String(128))
    brand_owner: Mapped[str | None] = mapped_column(String(256), nullable=True)
    publication_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    nutrients_per_100g: Mapped[dict] = mapped_column(json_variant)
    serving_size: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_size_unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    household_serving_text: Mapped[str | None] = mapped_column(String(256), nullable=True)
    original_nutrient_ids: Mapped[dict] = mapped_column(json_variant, default=dict)
    quality_flags: Mapped[list[str]] = mapped_column(json_variant, default=list)
    source_reference: Mapped[str] = mapped_column(String(512))
    source_retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FoodSourceConflict(Base):
    """Durable evidence that two provider records materially disagreed."""

    __tablename__ = "food_source_conflicts"
    __table_args__ = (
        UniqueConstraint(
            "first_food_source_record_id",
            "second_food_source_record_id",
            "conflict_type",
            name="uq_food_source_conflicts_pair_type",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    first_food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    second_food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    normalized_name: Mapped[str] = mapped_column(String(512), index=True)
    conflict_type: Mapped[str] = mapped_column(String(64), index=True)
    evidence_json: Mapped[dict] = mapped_column(json_variant, default=dict)
    first_detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class FoodSearchCache(Base):
    """A short-lived query-to-source-record index, never a nutrition snapshot."""

    __tablename__ = "food_search_caches"
    __table_args__ = (
        UniqueConstraint("normalized_query", "locale", name="uq_food_search_caches_query_locale"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    normalized_query: Mapped[str] = mapped_column(String(256), index=True)
    locale: Mapped[str] = mapped_column(String(32), index=True)
    food_source_record_ids: Mapped[list[str]] = mapped_column(json_variant, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class FoodServing(Base):
    __tablename__ = "food_servings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    label: Mapped[str] = mapped_column(String(256))
    quantity: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(64))
    grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    milliliters: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class NutrientDefinition(Base):
    __tablename__ = "nutrient_definitions"
    __table_args__ = (UniqueConstraint("code", name="uq_nutrient_definitions_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    code: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(256))
    unit: Mapped[str] = mapped_column(String(32))
    source_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_nutrient_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class FoodNutrient(Base):
    __tablename__ = "food_nutrients"
    __table_args__ = (
        UniqueConstraint(
            "food_source_record_id",
            "nutrient_definition_id",
            name="uq_food_nutrients_food_nutrient",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    nutrient_definition_id: Mapped[str] = mapped_column(
        ForeignKey("nutrient_definitions.id", ondelete="RESTRICT"),
        index=True,
    )
    amount_per_100g: Mapped[float] = mapped_column(Float)
    original_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    original_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)


class CustomFood(Base):
    __tablename__ = "custom_foods"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    display_name: Mapped[str] = mapped_column(String(512))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by_user: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
