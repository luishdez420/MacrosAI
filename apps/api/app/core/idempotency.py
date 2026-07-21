"""Safe, user-scoped request replay for retry-sensitive API mutations."""

import hashlib
import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.idempotency import IdempotencyRecord

MEAL_CREATE_OPERATION = "meal.create"
MEAL_ANALYSIS_OPERATION = "meal-analysis.create"
NUTRITION_LABEL_ANALYSIS_OPERATION = "nutrition-label-analysis.create"
CUSTOM_FOOD_CREATE_OPERATION = "food.custom.create"
FOOD_CORRECTION_REPORT_CREATE_OPERATION = "food.correction-report.create"
RECIPE_CREATE_OPERATION = "recipe.create"
RECIPE_LOG_OPERATION = "recipe.log"
MAX_IDEMPOTENCY_KEY_LENGTH = 128
PENDING_STATUS = "pending"
COMPLETED_STATUS = "completed"


@dataclass(frozen=True)
class IdempotencyReservation:
    record: IdempotencyRecord
    replay_body: dict[str, Any] | None = None

    @property
    def is_replay(self) -> bool:
        return self.replay_body is not None


def resolve_idempotency_key(
    header_value: str | None,
    body_value: str | None = None,
) -> str | None:
    """Accept a legacy body key while preferring the standard request header."""

    header_key = normalize_idempotency_key(header_value)
    body_key = normalize_idempotency_key(body_value)

    if header_key and body_key and header_key != body_key:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Idempotency-Key header must match idempotencyKey when both are supplied.",
        )

    return header_key or body_key


def normalize_idempotency_key(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    if len(normalized) > MAX_IDEMPOTENCY_KEY_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Idempotency-Key must be {MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.",
        )

    return normalized


def reserve_idempotency_key(
    db: Session,
    *,
    user_id: str,
    operation: str,
    idempotency_key: str | None,
    request_payload: object,
    commit: bool,
) -> IdempotencyReservation | None:
    """Reserve an action or return its completed response for an exact replay.

    A pending reservation has a bounded lease. Reclaiming an expired lease is
    preferable to permanently blocking the user after a process crash; the
    resource-specific write still supplies its own database constraint where
    needed (for example, meals retain their user/key uniqueness constraint).
    """

    if not idempotency_key:
        return None

    fingerprint = fingerprint_request(request_payload)
    existing = get_idempotency_record(db, user_id, operation, idempotency_key)
    if existing:
        return resolve_existing_reservation(
            db,
            existing=existing,
            fingerprint=fingerprint,
            commit=commit,
        )

    now = datetime.now(UTC)
    record = IdempotencyRecord(
        user_id=user_id,
        operation=operation,
        idempotency_key=idempotency_key,
        request_fingerprint=fingerprint,
        status=PENDING_STATUS,
        expires_at=now + timedelta(seconds=settings.idempotency_pending_ttl_seconds),
    )
    db.add(record)

    try:
        if commit:
            db.commit()
        else:
            db.flush()
    except IntegrityError:
        # A concurrent request claimed the same user/operation/key. Roll back
        # only work from this reservation attempt, then inspect the winner.
        db.rollback()
        existing = get_idempotency_record(db, user_id, operation, idempotency_key)
        if existing:
            return resolve_existing_reservation(
                db,
                existing=existing,
                fingerprint=fingerprint,
                commit=commit,
            )
        raise

    return IdempotencyReservation(record=record)


def complete_idempotency_key(
    db: Session,
    reservation: IdempotencyReservation | None,
    response_body: object,
    *,
    response_status: int,
    resource_type: str | None = None,
    resource_id: str | None = None,
    commit: bool,
) -> None:
    if not reservation or reservation.is_replay:
        return

    record = reservation.record
    record.status = COMPLETED_STATUS
    record.response_status = response_status
    record.response_body_json = jsonable_encoder(response_body)
    record.resource_type = resource_type
    record.resource_id = resource_id
    record.expires_at = datetime.now(UTC) + timedelta(
        seconds=settings.idempotency_response_ttl_seconds
    )

    if commit:
        db.commit()
    else:
        db.flush()


def discard_idempotency_key(db: Session, reservation: IdempotencyReservation | None) -> None:
    """Release a failed paid-action reservation so the caller can safely retry."""

    if not reservation or reservation.is_replay:
        return

    db.delete(reservation.record)
    db.commit()


def get_completed_replay(
    db: Session,
    *,
    user_id: str,
    operation: str,
    idempotency_key: str | None,
    request_payload: object,
) -> dict[str, Any] | None:
    """Read a completed response after a competing transaction committed."""

    if not idempotency_key:
        return None

    record = get_idempotency_record(db, user_id, operation, idempotency_key)
    if not record:
        return None

    reservation = resolve_existing_reservation(
        db,
        existing=record,
        fingerprint=fingerprint_request(request_payload),
        commit=False,
    )
    return reservation.replay_body


def fingerprint_request(payload: object) -> str:
    encoded = jsonable_encoder(payload)
    canonical = json.dumps(encoded, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def digest_sensitive_request_value(value: str) -> str:
    """Return a keyed digest for retry matching without serializing sensitive input.

    Image base64 is already present in the request parser, but callers should
    not create another full JSON copy simply to calculate an idempotency
    fingerprint. The digest is safe to keep inside the short-lived request
    fingerprint computation and cannot be reversed without the server secret.
    """

    return hmac.new(
        settings.jwt_secret.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def get_idempotency_record(
    db: Session,
    user_id: str,
    operation: str,
    idempotency_key: str,
) -> IdempotencyRecord | None:
    return db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.user_id == user_id,
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
    )


def resolve_existing_reservation(
    db: Session,
    *,
    existing: IdempotencyRecord,
    fingerprint: str,
    commit: bool,
) -> IdempotencyReservation:
    if existing.request_fingerprint != fingerprint:
        raise idempotency_conflict("This idempotency key was already used for a different request.")

    if existing.status == COMPLETED_STATUS and existing.response_body_json is not None:
        return IdempotencyReservation(record=existing, replay_body=existing.response_body_json)

    now = datetime.now(UTC)
    if existing.status == PENDING_STATUS and existing.expires_at <= now:
        existing.response_status = None
        existing.response_body_json = None
        existing.resource_type = None
        existing.resource_id = None
        existing.expires_at = now + timedelta(seconds=settings.idempotency_pending_ttl_seconds)
        if commit:
            db.commit()
        else:
            db.flush()
        return IdempotencyReservation(record=existing)

    raise idempotency_conflict("This request is already being processed. Please wait, then try again.")


def idempotency_conflict(message: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
