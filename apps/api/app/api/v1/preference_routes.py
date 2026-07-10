from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.user import UserPreference
from app.schemas.user import UserPreferenceRead, UserPreferenceUpdate

router = APIRouter()


@router.get("", response_model=UserPreferenceRead)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> UserPreferenceRead:
    return preference_to_read(get_or_create_preferences(db, current_user.id))


@router.put("", response_model=UserPreferenceRead, status_code=status.HTTP_200_OK)
def update_preferences(
    payload: UserPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> UserPreferenceRead:
    preferences = get_or_create_preferences(db, current_user.id)

    if payload.locale is not None:
        preferences.locale = payload.locale
    if payload.unit_system is not None:
        preferences.unit_system = payload.unit_system
    if payload.day_start_time is not None:
        preferences.day_start_time = payload.day_start_time
    if payload.timezone is not None:
        preferences.timezone = payload.timezone
    if payload.image_retention_days is not None:
        preferences.image_retention_days = payload.image_retention_days

    db.commit()
    db.refresh(preferences)
    return preference_to_read(preferences)


def get_or_create_preferences(db: Session, user_id: str) -> UserPreference:
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))

    if preferences:
        return preferences

    preferences = UserPreference(
        user_id=user_id,
        locale="en-US",
        unit_system="metric",
        timezone="UTC",
    )
    db.add(preferences)
    db.commit()
    db.refresh(preferences)
    return preferences


def preference_to_read(preferences: UserPreference) -> UserPreferenceRead:
    unit_system = "us" if preferences.unit_system == "us" else "metric"

    return UserPreferenceRead(
        id=preferences.id,
        locale=preferences.locale,
        unit_system=unit_system,
        day_start_time=preferences.day_start_time,
        timezone=preferences.timezone,
        image_retention_days=preferences.image_retention_days,
        created_at=preferences.created_at,
        updated_at=preferences.updated_at,
    )
