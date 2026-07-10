import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.v1.diary_routes import round_totals
from app.api.v1.goal_routes import latest_goal
from app.api.v1.meal_routes import day_bounds, meal_query
from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.meal import Meal
from app.schemas.insights import MonthlyInsightsRead, WeeklyInsightDay, WeeklyInsightsRead
from app.schemas.meal import DiaryTotals

router = APIRouter()

fallback_calorie_goal = 2200


@router.get("/weekly", response_model=WeeklyInsightsRead)
def get_weekly_insights(
    start_date: date | None = Query(default=None, alias="startDate"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> WeeklyInsightsRead:
    first_day = start_date or date.today() - timedelta(days=6)
    goal = latest_goal(db, current_user.id)
    calorie_target = goal.calories_kcal if goal else fallback_calorie_goal
    days = [
        build_weekly_insight_day(
            db,
            current_user.id,
            first_day + timedelta(days=offset),
            calorie_target,
        )
        for offset in range(7)
    ]
    goal_days = sum(1 for day in days if day.goal_met)
    logged_days = [day for day in days if day.meal_count > 0]
    average_calories = (
        round(sum(day.totals.calories for day in logged_days) / len(logged_days))
        if logged_days
        else 0
    )

    return WeeklyInsightsRead(
        start_date=first_day.isoformat(),
        end_date=days[-1].date,
        calorie_target=calorie_target,
        goal_days=goal_days,
        average_calories=average_calories,
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
    goal = latest_goal(db, current_user.id)
    calorie_target = goal.calories_kcal if goal else fallback_calorie_goal
    days = [
        build_weekly_insight_day(
            db,
            current_user.id,
            first_day + timedelta(days=offset),
            calorie_target,
        )
        for offset in range(days_in_month)
    ]
    goal_days = sum(1 for day in days if day.goal_met)
    logged_days = [day for day in days if day.meal_count > 0]
    average_calories = (
        round(sum(day.totals.calories for day in logged_days) / len(logged_days))
        if logged_days
        else 0
    )

    return MonthlyInsightsRead(
        month=first_day.strftime("%Y-%m"),
        start_date=first_day.isoformat(),
        end_date=days[-1].date,
        calorie_target=calorie_target,
        logged_days=len(logged_days),
        goal_days=goal_days,
        average_calories=average_calories,
        days=days,
    )


def build_weekly_insight_day(
    db: Session,
    user_id: str,
    logged_date: date,
    calorie_target: float,
) -> WeeklyInsightDay:
    start_at, end_at = day_bounds(logged_date)
    meals = db.scalars(
        meal_query(user_id)
        .where(Meal.logged_at >= start_at, Meal.logged_at < end_at)
        .order_by(Meal.logged_at.desc())
    ).all()
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
        totals=rounded_totals,
        meal_count=len(meals),
        goal_met=rounded_totals.calories > 0 and rounded_totals.calories <= calorie_target,
    )


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
