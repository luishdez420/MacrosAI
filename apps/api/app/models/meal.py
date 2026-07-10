from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.food import json_variant


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(256))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    items: Mapped[list["MealItem"]] = relationship(
        back_populates="meal",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="MealItem.created_at",
    )
    images: Mapped[list["MealImage"]] = relationship(
        back_populates="meal",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class MealItem(Base):
    __tablename__ = "meal_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    meal_id: Mapped[str] = mapped_column(ForeignKey("meals.id", ondelete="CASCADE"), index=True)
    food_source_record_id: Mapped[str | None] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    food_id: Mapped[str] = mapped_column(String(192))
    display_name: Mapped[str] = mapped_column(String(512))
    consumed_grams: Mapped[float] = mapped_column(Float)
    serving_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    serving_unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    calories: Mapped[float] = mapped_column(Float)
    protein_grams: Mapped[float] = mapped_column(Float)
    carbohydrate_grams: Mapped[float] = mapped_column(Float)
    fat_grams: Mapped[float] = mapped_column(Float)
    fiber_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    sugar_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_milligrams: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_provider: Mapped[str] = mapped_column(String(64))
    source_external_id: Mapped[str] = mapped_column(String(128))
    source_version: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)
    identity_confidence: Mapped[str] = mapped_column(String(32))
    portion_confidence: Mapped[str] = mapped_column(String(32))
    nutrition_record_confidence: Mapped[str] = mapped_column(String(32))
    confidence_explanation: Mapped[str] = mapped_column(Text)
    user_confirmed: Mapped[bool] = mapped_column(default=False)
    preparation_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    added_oil_grams: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    nutrient_snapshot_json: Mapped[dict] = mapped_column(json_variant)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    meal: Mapped[Meal] = relationship(back_populates="items")


class MealImage(Base):
    __tablename__ = "meal_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    meal_id: Mapped[str] = mapped_column(ForeignKey("meals.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(512))
    capture_angle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_type: Mapped[str] = mapped_column(String(128), default="image/jpeg")
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    metadata_removed: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    meal: Mapped[Meal] = relationship(back_populates="images")
