from datetime import datetime
from enum import Enum

from pydantic import Field

from app.schemas.common import ApiModel, ConfidenceBreakdown, NutrientsPer100g


class MealType(str, Enum):
    breakfast = "breakfast"
    lunch = "lunch"
    dinner = "dinner"
    snack = "snack"
    meal = "meal"


class MealItemCreate(ApiModel):
    food_id: str
    display_name: str
    consumed_grams: float = Field(gt=0)
    serving_quantity: float | None = Field(default=None, ge=0)
    serving_unit: str | None = None
    calories: float = Field(ge=0)
    protein_grams: float = Field(ge=0)
    carbohydrate_grams: float = Field(ge=0)
    fat_grams: float = Field(ge=0)
    fiber_grams: float | None = Field(default=None, ge=0)
    sugar_grams: float | None = Field(default=None, ge=0)
    sodium_milligrams: float | None = Field(default=None, ge=0)
    source_provider: str
    source_external_id: str
    source_version: str | None = None
    source_reference: str | None = None
    nutrient_snapshot_json: dict
    confidence: ConfidenceBreakdown
    user_confirmed: bool
    preparation_method: str | None = None
    added_oil_grams: float = Field(default=0, ge=0)
    notes: str | None = None


class MealCreate(ApiModel):
    name: str = Field(min_length=1)
    meal_type: MealType = MealType.meal
    logged_at: datetime | None = None
    notes: str | None = None
    items: list[MealItemCreate] = Field(min_length=1)
    # Scan images remain temporary unless the person explicitly opts in while
    # confirming this meal. The job ID is never used as a public image key.
    analysis_job_id: str | None = Field(default=None, min_length=1, max_length=36)
    retain_analysis_images: bool = False


class MealImageRead(ApiModel):
    id: str
    capture_angle: str | None = None
    content_type: str
    retention_deadline: datetime | None = None
    created_at: datetime


class MealImageAccessRead(ApiModel):
    url: str
    expires_in_seconds: int


class MealUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1)
    meal_type: MealType | None = None
    logged_at: datetime | None = None
    notes: str | None = None
    items: list[MealItemCreate] | None = None


class MealItemRead(MealItemCreate):
    id: str
    created_at: datetime
    updated_at: datetime


class MealRead(ApiModel):
    id: str
    name: str
    meal_type: MealType = MealType.meal
    logged_at: datetime
    notes: str | None = None
    items: list[MealItemRead]
    images: list[MealImageRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class DiaryTotals(ApiModel):
    calories: float = 0
    protein_grams: float = 0
    carbohydrate_grams: float = 0
    fat_grams: float = 0
    fiber_grams: float = 0
    sugar_grams: float = 0
    sodium_milligrams: float = 0


class DiaryDayRead(ApiModel):
    date: str
    totals: DiaryTotals
    meals: list[MealRead]


def totals_to_nutrients(totals: DiaryTotals) -> NutrientsPer100g:
    return NutrientsPer100g(
        calories_kcal=totals.calories,
        protein_grams=totals.protein_grams,
        carbohydrate_grams=totals.carbohydrate_grams,
        fat_grams=totals.fat_grams,
        fiber_grams=totals.fiber_grams,
        sugar_grams=totals.sugar_grams,
        sodium_milligrams=totals.sodium_milligrams,
    )
