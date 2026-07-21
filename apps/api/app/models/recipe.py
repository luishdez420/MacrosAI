from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.food import json_variant


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(256))
    meal_type: Mapped[str] = mapped_column(String(32), default="meal")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    times_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    items: Mapped[list["RecipeItem"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="RecipeItem.sort_order, RecipeItem.created_at",
    )


class RecipeItem(Base):
    __tablename__ = "recipe_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    recipe_id: Mapped[str] = mapped_column(ForeignKey("recipes.id", ondelete="CASCADE"), index=True)
    food_id: Mapped[str] = mapped_column(String(192))
    display_name: Mapped[str] = mapped_column(String(512))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
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

    recipe: Mapped[Recipe] = relationship(back_populates="items")
