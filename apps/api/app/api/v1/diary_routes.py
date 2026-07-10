from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.meal_routes import day_bounds, meal_query, meal_to_read
from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.meal import Meal
from app.schemas.meal import DiaryDayRead, DiaryTotals

router = APIRouter()


@router.get("/{logged_date}", response_model=DiaryDayRead)
def get_diary_day(
    logged_date: date,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> DiaryDayRead:
    start_at, end_at = day_bounds(logged_date)
    meals = db.scalars(
        meal_query(current_user.id)
        .where(Meal.logged_at >= start_at, Meal.logged_at < end_at)
        .order_by(Meal.logged_at.desc())
    ).all()
    meal_reads = [meal_to_read(meal) for meal in meals]

    totals = DiaryTotals()
    for meal in meal_reads:
        for item in meal.items:
            totals.calories += item.calories
            totals.protein_grams += item.protein_grams
            totals.carbohydrate_grams += item.carbohydrate_grams
            totals.fat_grams += item.fat_grams
            totals.fiber_grams += item.fiber_grams or 0
            totals.sugar_grams += item.sugar_grams or 0
            totals.sodium_milligrams += item.sodium_milligrams or 0

    return DiaryDayRead(
        date=logged_date.isoformat(),
        totals=round_totals(totals),
        meals=meal_reads,
    )


def round_totals(totals: DiaryTotals) -> DiaryTotals:
    return DiaryTotals(
        calories=round(totals.calories, 1),
        protein_grams=round(totals.protein_grams, 1),
        carbohydrate_grams=round(totals.carbohydrate_grams, 1),
        fat_grams=round(totals.fat_grams, 1),
        fiber_grams=round(totals.fiber_grams, 1),
        sugar_grams=round(totals.sugar_grams, 1),
        sodium_milligrams=round(totals.sodium_milligrams, 1),
    )
