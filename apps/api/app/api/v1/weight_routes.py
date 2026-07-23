from datetime import date

from fastapi import APIRouter, Depends, Header, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth import CurrentUser, ensure_current_user
from app.core.idempotency import (
    WEIGHT_ENTRY_UPSERT_OPERATION,
    complete_idempotency_key,
    get_completed_replay,
    reserve_idempotency_key,
    resolve_idempotency_key,
)
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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> WeightEntryRead:
    logged_on = payload.logged_on or date.today()
    resolved_key = resolve_idempotency_key(idempotency_key)
    request_payload = payload.model_dump(mode="json")
    # Persist the resolved day in the fingerprint so an omitted date cannot
    # accidentally replay a different calendar day's weight entry.
    request_payload["logged_on"] = logged_on.isoformat()
    completed_replay = get_completed_replay(
        db,
        user_id=current_user.id,
        operation=WEIGHT_ENTRY_UPSERT_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
    )
    if completed_replay:
        return WeightEntryRead.model_validate(completed_replay)

    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=WEIGHT_ENTRY_UPSERT_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
        commit=False,
    )
    if reservation and reservation.is_replay:
        return WeightEntryRead.model_validate(reservation.replay_body)

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
    try:
        db.flush()
        response = weight_entry_to_read(entry)
        complete_idempotency_key(
            db,
            reservation,
            response,
            response_status=status.HTTP_201_CREATED,
            resource_type="weight_entry",
            resource_id=entry.id,
            commit=False,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = get_completed_replay(
            db,
            user_id=current_user.id,
            operation=WEIGHT_ENTRY_UPSERT_OPERATION,
            idempotency_key=resolved_key,
            request_payload=request_payload,
        )
        if replay:
            return WeightEntryRead.model_validate(replay)
        raise

    return response


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
