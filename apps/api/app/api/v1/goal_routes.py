from datetime import date, timedelta

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.user import NutritionGoal
from app.schemas.user import NutritionGoalRead, NutritionGoalUpdate

router = APIRouter()


@router.get("/history", response_model=list[NutritionGoalRead])
def list_goal_history(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> list[NutritionGoalRead]:
    goals = db.scalars(
        select(NutritionGoal)
        .where(NutritionGoal.user_id == current_user.id)
        .order_by(NutritionGoal.starts_on.desc(), NutritionGoal.created_at.desc())
    ).all()
    return [goal_to_read(goal) for goal in goals]


@router.get("", response_model=NutritionGoalRead | None)
def get_current_goal(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> NutritionGoalRead | None:
    goal = goal_for_date(db, current_user.id, date.today())
    return goal_to_read(goal) if goal else None


@router.put("", response_model=NutritionGoalRead, status_code=status.HTTP_200_OK)
def update_current_goal(
    payload: NutritionGoalUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> NutritionGoalRead:
    effective_date = payload.starts_on or date.today()
    goal = db.scalar(
        select(NutritionGoal)
        .where(
            NutritionGoal.user_id == current_user.id,
            NutritionGoal.starts_on == effective_date,
        )
        .order_by(NutritionGoal.created_at.desc())
    )

    if not goal:
        goal = NutritionGoal(user_id=current_user.id, starts_on=effective_date)
        db.add(goal)

    goal.calories_kcal = payload.calories_kcal
    goal.protein_grams = payload.protein_grams
    goal.carbohydrate_grams = payload.carbohydrate_grams
    goal.fat_grams = payload.fat_grams
    goal.fiber_grams = payload.fiber_grams
    goal.sodium_milligrams = payload.sodium_milligrams
    if payload.goal_direction is not None:
        goal.goal_direction = payload.goal_direction

    db.commit()
    db.refresh(goal)
    return goal_to_read(goal)


def latest_goal(db: Session, user_id: str) -> NutritionGoal | None:
    return goal_for_date(db, user_id, date.today())


def goal_for_date(db: Session, user_id: str, target_date: date) -> NutritionGoal | None:
    return db.scalar(
        select(NutritionGoal)
        .where(
            NutritionGoal.user_id == user_id,
            NutritionGoal.starts_on <= target_date,
        )
        .order_by(NutritionGoal.starts_on.desc(), NutritionGoal.created_at.desc())
    )


def goals_by_date(
    db: Session,
    user_id: str,
    start_date: date,
    end_date: date,
) -> dict[date, NutritionGoal]:
    """Resolve the user goal effective on every date in an inclusive range."""

    if end_date < start_date:
        return {}

    goal_revisions = db.scalars(
        select(NutritionGoal)
        .where(
            NutritionGoal.user_id == user_id,
            NutritionGoal.starts_on <= end_date,
        )
        .order_by(NutritionGoal.starts_on.asc(), NutritionGoal.created_at.asc())
    ).all()
    revisions_by_start = {goal.starts_on: goal for goal in goal_revisions}
    active_goal = goal_for_date(db, user_id, start_date)
    result: dict[date, NutritionGoal] = {}
    current_date = start_date

    while current_date <= end_date:
        revision = revisions_by_start.get(current_date)
        if revision:
            active_goal = revision

        if active_goal:
            result[current_date] = active_goal
        current_date += timedelta(days=1)

    return result


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
        goal_direction=goal.goal_direction,
        created_at=goal.created_at,
        updated_at=goal.updated_at,
    )
