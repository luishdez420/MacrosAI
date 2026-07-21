from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel
from app.schemas.meal import MealItemCreate, MealItemRead, MealRead, MealType


class RecipeCreate(ApiModel):
    name: str = Field(min_length=1, max_length=256)
    meal_type: MealType = MealType.meal
    notes: str | None = None
    items: list[MealItemCreate] = Field(min_length=1)


class RecipeUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    meal_type: MealType | None = None
    notes: str | None = None
    items: list[MealItemCreate] | None = Field(default=None, min_length=1)


class RecipeRead(ApiModel):
    id: str
    name: str
    meal_type: MealType = MealType.meal
    notes: str | None = None
    times_used: int
    items: list[MealItemRead]
    created_at: datetime
    updated_at: datetime


class RecipeLogResult(ApiModel):
    recipe: RecipeRead
    meal: MealRead
