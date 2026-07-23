from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("auth_provider", "external_subject", name="uq_users_auth_provider_subject"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str | None] = mapped_column(String(320), unique=True, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(64), default="dev")
    external_subject: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    locale: Mapped[str] = mapped_column(String(16), default="en-US")
    unit_system: Mapped[str] = mapped_column(String(16), default="metric")
    day_start_time: Mapped[str] = mapped_column(String(8), default="00:00")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    goal_direction: Mapped[str] = mapped_column(String(16), default="maintain")
    onboarding_goal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    logging_preference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    dietary_preferences: Mapped[list[str]] = mapped_column(JSON, default=list)
    theme_preference: Mapped[str] = mapped_column(String(16), default="system")
    image_retention_days: Mapped[int] = mapped_column(default=30)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_label: Mapped[str | None] = mapped_column(String(96), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    # Account deletion clears this link while retaining an anonymous operations record.
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(96), index=True)
    outcome: Mapped[str] = mapped_column(String(32), default="success")
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    client_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditDelivery(Base):
    """Durable outbox state for privacy-minimized external audit delivery."""

    __tablename__ = "audit_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    audit_log_id: Mapped[str] = mapped_column(
        ForeignKey("audit_logs.id", ondelete="CASCADE"),
        unique=True,
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NutritionGoal(Base):
    __tablename__ = "nutrition_goals"
    __table_args__ = (Index("ix_nutrition_goals_user_starts_on", "user_id", "starts_on"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    starts_on: Mapped[date] = mapped_column(Date, default=date.today)
    calories_kcal: Mapped[float] = mapped_column(Float)
    protein_grams: Mapped[float] = mapped_column(Float)
    carbohydrate_grams: Mapped[float] = mapped_column(Float)
    fat_grams: Mapped[float] = mapped_column(Float)
    fiber_grams: Mapped[float | None] = mapped_column(Float, nullable=True)
    sodium_milligrams: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Direction is stored with the effective-dated nutrition goal so insight
    # comparisons never infer a historical intent from today's preference.
    goal_direction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class WeightEntry(Base):
    __tablename__ = "weight_entries"
    __table_args__ = (UniqueConstraint("user_id", "logged_on", name="uq_weight_entries_user_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    logged_on: Mapped[date] = mapped_column(Date, index=True)
    weight_grams: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HydrationEntry(Base):
    __tablename__ = "hydration_entries"
    __table_args__ = (UniqueConstraint("user_id", "logged_on", name="uq_hydration_entries_user_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    logged_on: Mapped[date] = mapped_column(Date, index=True)
    milliliters: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FavoriteFood(Base):
    __tablename__ = "favorite_foods"
    __table_args__ = (
        UniqueConstraint("user_id", "food_source_record_id", name="uq_favorite_foods_user_food"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FavoriteFoodTag(Base):
    """A private organization label owned by one account."""

    __tablename__ = "favorite_food_tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_favorite_food_tags_user_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(48))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FavoriteFoodTagAssignment(Base):
    """Associates a user's favorite with one of their private tags."""

    __tablename__ = "favorite_food_tag_assignments"
    __table_args__ = (
        UniqueConstraint(
            "favorite_food_id",
            "favorite_food_tag_id",
            name="uq_favorite_food_tag_assignments_favorite_tag",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    favorite_food_id: Mapped[str] = mapped_column(
        ForeignKey("favorite_foods.id", ondelete="CASCADE"),
        index=True,
    )
    favorite_food_tag_id: Mapped[str] = mapped_column(
        ForeignKey("favorite_food_tags.id", ondelete="CASCADE"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RecentFood(Base):
    __tablename__ = "recent_foods"
    __table_args__ = (
        UniqueConstraint("user_id", "food_source_record_id", name="uq_recent_foods_user_food"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    food_source_record_id: Mapped[str] = mapped_column(
        ForeignKey("food_source_records.id", ondelete="CASCADE"),
        index=True,
    )
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    use_count: Mapped[int] = mapped_column(default=1)
