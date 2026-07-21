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
    days: list[WeeklyInsightDay]
