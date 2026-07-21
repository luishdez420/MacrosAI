from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.user import HydrationEntry
from app.schemas.user import HydrationEntryRead, HydrationEntryUpdate

router = APIRouter()


@router.get("/{logged_on}", response_model=HydrationEntryRead | None)
def get_hydration_entry(
    logged_on: date,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> HydrationEntryRead | None:
    entry = find_hydration_entry(db, current_user.id, logged_on)
    return hydration_entry_to_read(entry) if entry else None


@router.put("/{logged_on}", response_model=HydrationEntryRead)
def upsert_hydration_entry(
    logged_on: date,
    payload: HydrationEntryUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> HydrationEntryRead:
    entry = find_hydration_entry(db, current_user.id, logged_on)

    if not entry:
        entry = HydrationEntry(user_id=current_user.id, logged_on=logged_on)
        db.add(entry)

    entry.milliliters = payload.milliliters
    db.commit()
    db.refresh(entry)
    return hydration_entry_to_read(entry)


@router.delete("/{logged_on}", status_code=status.HTTP_204_NO_CONTENT)
def delete_hydration_entry(
    logged_on: date,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    entry = find_hydration_entry(db, current_user.id, logged_on)
    if entry:
        db.delete(entry)
        db.commit()


def find_hydration_entry(db: Session, user_id: str, logged_on: date) -> HydrationEntry | None:
    return db.scalar(
        select(HydrationEntry).where(
            HydrationEntry.user_id == user_id,
            HydrationEntry.logged_on == logged_on,
        )
    )


def hydration_entry_to_read(entry: HydrationEntry) -> HydrationEntryRead:
    return HydrationEntryRead(
        id=entry.id,
        logged_on=entry.logged_on,
        milliliters=entry.milliliters,
        created_at=entry.created_at,
    )
