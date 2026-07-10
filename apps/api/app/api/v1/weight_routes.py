from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.user import WeightEntry
from app.schemas.user import WeightEntryCreate, WeightEntryRead

router = APIRouter()


@router.get("", response_model=list[WeightEntryRead])
def list_weight_entries(
    limit: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> list[WeightEntryRead]:
    entries = db.scalars(
        select(WeightEntry)
        .where(WeightEntry.user_id == current_user.id)
        .order_by(WeightEntry.logged_on.desc(), WeightEntry.created_at.desc())
        .limit(limit)
    ).all()

    return [weight_entry_to_read(entry) for entry in entries]


@router.post("", response_model=WeightEntryRead, status_code=status.HTTP_201_CREATED)
def upsert_weight_entry(
    payload: WeightEntryCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> WeightEntryRead:
    logged_on = payload.logged_on or date.today()
    entry = db.scalar(
        select(WeightEntry).where(
            WeightEntry.user_id == current_user.id,
            WeightEntry.logged_on == logged_on,
        )
    )

    if not entry:
        entry = WeightEntry(user_id=current_user.id, logged_on=logged_on)
        db.add(entry)

    entry.weight_grams = payload.weight_grams
    entry.notes = payload.notes
    db.commit()
    db.refresh(entry)

    return weight_entry_to_read(entry)


@router.delete("/{logged_on}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weight_entry(
    logged_on: date,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    entry = db.scalar(
        select(WeightEntry).where(
            WeightEntry.user_id == current_user.id,
            WeightEntry.logged_on == logged_on,
        )
    )

    if entry:
        db.delete(entry)
        db.commit()


def weight_entry_to_read(entry: WeightEntry) -> WeightEntryRead:
    return WeightEntryRead(
        id=entry.id,
        logged_on=entry.logged_on,
        weight_grams=entry.weight_grams,
        notes=entry.notes,
        created_at=entry.created_at,
    )
