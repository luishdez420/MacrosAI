from app.schemas.common import ApiModel
from app.schemas.meal import DiaryTotals


class WeeklyInsightDay(ApiModel):
    date: str
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
