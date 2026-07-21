from datetime import datetime
from typing import Literal

from app.schemas.auth import UserSession
from app.schemas.common import ApiModel
from app.schemas.food import FoodSearchResult
from app.schemas.meal import MealRead
from app.schemas.recipe import RecipeRead
from app.schemas.user import HydrationEntryRead, NutritionGoalRead, UserPreferenceRead, WeightEntryRead


EXPORT_FORMAT_VERSION = "living-nutrition-export/v1"


class UserDataExportRead(ApiModel):
    format_version: Literal[EXPORT_FORMAT_VERSION] = EXPORT_FORMAT_VERSION
    generated_at: datetime
    user: UserSession
    preferences: UserPreferenceRead
    goals: list[NutritionGoalRead]
    weight_entries: list[WeightEntryRead]
    hydration_entries: list[HydrationEntryRead]
    meals: list[MealRead]
    recipes: list[RecipeRead]
    favorite_foods: list[FoodSearchResult]
    recent_foods: list[FoodSearchResult]
    custom_foods: list[FoodSearchResult]
