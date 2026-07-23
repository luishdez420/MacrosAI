from datetime import date
from typing import Literal

from app.schemas.common import ApiModel
from app.schemas.meal import DiaryTotals


class WeeklyInsightDay(ApiModel):
    date: str
    calorie_target: float
    totals: DiaryTotals
    meal_count: int
    goal_met: bool


class WeeklyInsightsRead(ApiModel):
    start_date: str
    end_date: str
    calorie_target: float
    goal_days: int
    average_calories: float
    days: list[WeeklyInsightDay]


class MonthlyInsightsRead(ApiModel):
    month: str
    start_date: str
    end_date: str
    calorie_target: float
    logged_days: int
    goal_days: int
    average_calories: float
    days: list[WeeklyInsightDay]


class WeightComparisonRead(ApiModel):
    """A descriptive weight comparison for a selected date range."""

    status: Literal["insufficient_data", "limited", "observed"]
    trend: Literal["up", "down", "steady", "unavailable"]
    entry_count: int
    first_logged_on: date | None = None
    last_logged_on: date | None = None
    observation_days: int = 0
    change_grams: float | None = None
    goal_direction_context: Literal["consistent", "changed", "unavailable"]
    goal_directions: list[Literal["maintain", "cut", "gain"]]
    goal_revision_count: int


class RangeInsightsRead(ApiModel):
    start_date: str
    end_date: str
    duration_days: int
    calorie_target: float
    logged_days: int
    goal_days: int
    average_calories: float
    average_protein_grams: float
    average_fiber_grams: float
    weight_comparison: WeightComparisonRead
    days: list[WeeklyInsightDay]
