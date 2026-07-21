from datetime import date, datetime

from pydantic import Field
from typing import Literal

from app.schemas.common import ApiModel


DietaryPreference = Literal["vegetarian", "vegan", "pescatarian", "gluten_free", "dairy_free"]


class UserPreferenceRead(ApiModel):
    id: str
    locale: str
    unit_system: Literal["us", "metric"]
    day_start_time: str
    timezone: str
    goal_direction: Literal["maintain", "cut", "gain"]
    onboarding_goal: Literal[
        "build_strength",
        "maintain_rhythm",
        "improve_nutrition",
        "lose_gradually",
        "support_performance",
        "track_macros",
    ] | None = None
    logging_preference: Literal[
        "kitchen_scale",
        "package_labels",
        "household_servings",
        "visual_estimates",
    ] | None = None
    dietary_preferences: list[DietaryPreference]
    theme_preference: Literal["system", "light", "dark"]
    image_retention_days: int
    created_at: datetime
    updated_at: datetime


class UserPreferenceUpdate(ApiModel):
    locale: str | None = Field(default=None, min_length=2, max_length=16)
    unit_system: Literal["us", "metric"] | None = None
    day_start_time: str | None = Field(default=None, min_length=4, max_length=8)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)
    goal_direction: Literal["maintain", "cut", "gain"] | None = None
    onboarding_goal: Literal[
        "build_strength",
        "maintain_rhythm",
        "improve_nutrition",
        "lose_gradually",
        "support_performance",
        "track_macros",
    ] | None = None
    logging_preference: Literal[
        "kitchen_scale",
        "package_labels",
        "household_servings",
        "visual_estimates",
    ] | None = None
    dietary_preferences: list[DietaryPreference] | None = Field(default=None, max_length=5)
    theme_preference: Literal["system", "light", "dark"] | None = None
    image_retention_days: int | None = Field(default=None, ge=0, le=365)


class NutritionGoalRead(ApiModel):
    id: str
    starts_on: date
    calories_kcal: float
    protein_grams: float
    carbohydrate_grams: float
    fat_grams: float
    fiber_grams: float | None = None
    sodium_milligrams: float | None = None
    created_at: datetime
    updated_at: datetime


class NutritionGoalUpdate(ApiModel):
    starts_on: date | None = None
    calories_kcal: float = Field(gt=0)
    protein_grams: float = Field(ge=0)
    carbohydrate_grams: float = Field(ge=0)
    fat_grams: float = Field(ge=0)
    fiber_grams: float | None = Field(default=None, ge=0)
    sodium_milligrams: float | None = Field(default=None, ge=0)


class WeightEntryCreate(ApiModel):
    logged_on: date | None = None
    weight_grams: float = Field(gt=0)
    notes: str | None = None


class WeightEntryRead(ApiModel):
    id: str
    logged_on: date
    weight_grams: float
    notes: str | None = None
    created_at: datetime


class HydrationEntryUpdate(ApiModel):
    milliliters: int = Field(gt=0, le=20_000)


class HydrationEntryRead(ApiModel):
    id: str
    logged_on: date
    milliliters: int
    created_at: datetime
