from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.user import NutritionGoal
from app.schemas.user import NutritionGoalRead, NutritionGoalUpdate

router = APIRouter()


@router.get("", response_model=NutritionGoalRead | None)
def get_current_goal(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> NutritionGoalRead | None:
    goal = latest_goal(db, current_user.id)
    return goal_to_read(goal) if goal else None


@router.put("", response_model=NutritionGoalRead, status_code=status.HTTP_200_OK)
def update_current_goal(
    payload: NutritionGoalUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> NutritionGoalRead:
    goal = latest_goal(db, current_user.id)

    if not goal:
        goal = NutritionGoal(user_id=current_user.id)
        db.add(goal)

    goal.starts_on = payload.starts_on or date.today()
    goal.calories_kcal = payload.calories_kcal
    goal.protein_grams = payload.protein_grams
    goal.carbohydrate_grams = payload.carbohydrate_grams
    goal.fat_grams = payload.fat_grams
    goal.fiber_grams = payload.fiber_grams
    goal.sodium_milligrams = payload.sodium_milligrams

    db.commit()
    db.refresh(goal)
    return goal_to_read(goal)


def latest_goal(db: Session, user_id: str) -> NutritionGoal | None:
    return db.scalar(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == user_id)
        .order_by(NutritionGoal.starts_on.desc(), NutritionGoal.created_at.desc())
    )


def goal_to_read(goal: NutritionGoal) -> NutritionGoalRead:
    return NutritionGoalRead(
        id=goal.id,
        starts_on=goal.starts_on,
        calories_kcal=goal.calories_kcal,
        protein_grams=goal.protein_grams,
        carbohydrate_grams=goal.carbohydrate_grams,
        fat_grams=goal.fat_grams,
        fiber_grams=goal.fiber_grams,
        sodium_milligrams=goal.sodium_milligrams,
        created_at=goal.created_at,
        updated_at=goal.updated_at,
    )
