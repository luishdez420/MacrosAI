import calendar
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.v1.diary_routes import round_totals
from app.api.v1.goal_routes import goal_for_date, goals_by_date
from app.api.v1.meal_routes import day_bounds, meal_query
from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.meal import Meal
from app.schemas.insights import (
    MonthlyInsightsRead,
    RangeInsightsRead,
    WeeklyInsightDay,
    WeeklyInsightsRead,
)
from app.schemas.meal import DiaryTotals

router = APIRouter()

fallback_calorie_goal = 2200
max_insight_range_days = 366


@router.get("/weekly", response_model=WeeklyInsightsRead)
def get_weekly_insights(
    start_date: date | None = Query(default=None, alias="startDate"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> WeeklyInsightsRead:
    first_day = start_date or date.today() - timedelta(days=6)
    end_date = first_day + timedelta(days=6)
    days = build_insight_days(db, current_user.id, first_day, end_date)
    summary = summarize_days(days)
    calorie_target = calorie_target_for_date(db, current_user.id, end_date)

    return WeeklyInsightsRead(
        start_date=first_day.isoformat(),
        end_date=days[-1].date,
        calorie_target=calorie_target,
        goal_days=summary.goal_days,
        average_calories=summary.average_calories,
        days=days,
    )


@router.get("/monthly", response_model=MonthlyInsightsRead)
def get_monthly_insights(
    month: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> MonthlyInsightsRead:
    first_day = month_start(month)
    _, days_in_month = calendar.monthrange(first_day.year, first_day.month)
    end_date = first_day + timedelta(days=days_in_month - 1)
    days = build_insight_days(db, current_user.id, first_day, end_date)
    summary = summarize_days(days)
    calorie_target = calorie_target_for_date(db, current_user.id, end_date)

    return MonthlyInsightsRead(
        month=first_day.strftime("%Y-%m"),
        start_date=first_day.isoformat(),
        end_date=days[-1].date,
        calorie_target=calorie_target,
        logged_days=summary.logged_days,
        goal_days=summary.goal_days,
        average_calories=summary.average_calories,
        days=days,
    )


@router.get("/range", response_model=RangeInsightsRead)
def get_range_insights(
    start_date: date = Query(alias="startDate"),
    end_date: date = Query(alias="endDate"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RangeInsightsRead:
    duration_days = (end_date - start_date).days + 1

    if duration_days <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="endDate must be on or after startDate.",
        )

    if duration_days > max_insight_range_days:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Insight ranges cannot exceed {max_insight_range_days} days.",
        )

    days = build_insight_days(db, current_user.id, start_date, end_date)
    summary = summarize_days(days)
    calorie_target = calorie_target_for_date(db, current_user.id, end_date)

    return RangeInsightsRead(
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        duration_days=duration_days,
        calorie_target=calorie_target,
        logged_days=summary.logged_days,
        goal_days=summary.goal_days,
        average_calories=summary.average_calories,
        average_protein_grams=summary.average_protein_grams,
        average_fiber_grams=summary.average_fiber_grams,
        days=days,
    )


def build_insight_days(
    db: Session,
    user_id: str,
    start_date: date,
    end_date: date,
) -> list[WeeklyInsightDay]:
    start_at, _ = day_bounds(start_date)
    _, end_at = day_bounds(end_date)
    meals = db.scalars(
        meal_query(user_id)
        .where(Meal.logged_at >= start_at, Meal.logged_at < end_at)
        .order_by(Meal.logged_at.desc())
    ).all()

    meals_by_date: dict[date, list[Meal]] = {}
    for meal in meals:
        meals_by_date.setdefault(insight_date_for_meal(meal.logged_at), []).append(meal)

    effective_goals = goals_by_date(db, user_id, start_date, end_date)

    days: list[WeeklyInsightDay] = []
    for offset in range((end_date - start_date).days + 1):
        logged_date = start_date + timedelta(days=offset)
        goal = effective_goals.get(logged_date)
        days.append(
            build_insight_day(
                logged_date=logged_date,
                meals=meals_by_date.get(logged_date, []),
                calorie_target=goal.calories_kcal if goal else fallback_calorie_goal,
            )
        )

    return days


def build_insight_day(
    logged_date: date,
    meals: list[Meal],
    calorie_target: float,
) -> WeeklyInsightDay:
    totals = DiaryTotals()

    for meal in meals:
        for item in meal.items:
            totals.calories += item.calories
            totals.protein_grams += item.protein_grams
            totals.carbohydrate_grams += item.carbohydrate_grams
            totals.fat_grams += item.fat_grams
            totals.fiber_grams += item.fiber_grams or 0
            totals.sugar_grams += item.sugar_grams or 0
            totals.sodium_milligrams += item.sodium_milligrams or 0

    rounded_totals = round_totals(totals)
    return WeeklyInsightDay(
        date=logged_date.isoformat(),
        calorie_target=calorie_target,
        totals=rounded_totals,
        meal_count=len(meals),
        goal_met=rounded_totals.calories > 0 and rounded_totals.calories <= calorie_target,
    )


class InsightSummary:
    def __init__(self, days: list[WeeklyInsightDay]) -> None:
        logged_days = [day for day in days if day.meal_count > 0]
        self.logged_days = len(logged_days)
        self.goal_days = sum(1 for day in days if day.goal_met)
        self.average_calories = average_logged_nutrient(logged_days, "calories")
        self.average_protein_grams = average_logged_nutrient(logged_days, "protein_grams")
        self.average_fiber_grams = average_logged_nutrient(logged_days, "fiber_grams")


def summarize_days(days: list[WeeklyInsightDay]) -> InsightSummary:
    return InsightSummary(days)


def average_logged_nutrient(days: list[WeeklyInsightDay], nutrient: str) -> float:
    if not days:
        return 0

    return round(sum(float(getattr(day.totals, nutrient)) for day in days) / len(days), 1)


def insight_date_for_meal(logged_at: datetime) -> date:
    if logged_at.tzinfo is None:
        return logged_at.date()

    return logged_at.astimezone(UTC).date()


def calorie_target_for_date(db: Session, user_id: str, target_date: date) -> float:
    goal = goal_for_date(db, user_id, target_date)
    return goal.calories_kcal if goal else fallback_calorie_goal


def month_start(month: str | None) -> date:
    if not month:
        today = date.today()
        return date(today.year, today.month, 1)

    try:
        year_text, month_text = month.split("-", 1)
        year = int(year_text)
        month_number = int(month_text)
        return date(year, month_number, 1)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="month must use YYYY-MM format.",
        ) from None
