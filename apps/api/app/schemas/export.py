from datetime import datetime

from app.schemas.auth import UserSession
from app.schemas.common import ApiModel
from app.schemas.food import FoodSearchResult
from app.schemas.meal import MealRead
from app.schemas.user import NutritionGoalRead, UserPreferenceRead, WeightEntryRead


class UserDataExportRead(ApiModel):
    generated_at: datetime
    user: UserSession
    preferences: UserPreferenceRead
    goals: list[NutritionGoalRead]
    weight_entries: list[WeightEntryRead]
    meals: list[MealRead]
    favorite_foods: list[FoodSearchResult]
    recent_foods: list[FoodSearchResult]
    custom_foods: list[FoodSearchResult]
