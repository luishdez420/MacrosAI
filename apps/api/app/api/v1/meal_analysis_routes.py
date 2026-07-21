import base64
import hashlib
import hmac
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.analysis.meal_analyzer import analyze_meal_photo, sanitize_base64_images
from app.core.auth import CurrentUser, ensure_current_user
from app.core.authorization import raise_owner_scoped_not_found
from app.core.config import settings
from app.core.ai_quota import (
    AI_OPERATION_MEAL_ANALYSIS,
    AiQuotaExceededError,
    quota_response_headers,
    refund_ai_usage,
    refund_ai_usage_record,
    reserve_ai_usage,
    settle_ai_usage,
)
from app.core.audit import record_audit_event
from app.core.idempotency import (
    MEAL_ANALYSIS_OPERATION,
    complete_idempotency_key,
    digest_sensitive_request_value,
    discard_idempotency_key,
    reserve_idempotency_key,
    resolve_idempotency_key,
)
from app.db.session import get_db
from app.models.analysis import AnalysisJob
from app.nutrition.provider_registry import NutritionProviderRegistry, get_provider_registry
from app.schemas.analysis import (
    AnalysisJobResponse,
    MealAnalysisJobCreateRequest,
    MealAnalysisRequest,
    MealAnalysisResult,
)
from app.services.analysis_jobs import (
    cancel_analysis_job,
    create_queued_analysis_job,
    get_owned_analysis_job_or_none,
)
from app.services.image_lifecycle import delete_analysis_job_images
from app.storage import PrivateImageStorage, build_private_image_storage

router = APIRouter()
MEAL_ANALYSIS_JOB_OPERATION = "meal-analysis.job.create"


def require_ai_features_enabled() -> None:
    """Block preview deployments before they retain images or reserve quota."""

    if not settings.ai_features_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Camera analysis is unavailable in this free preview. "
                "Use manual search, barcode lookup, or a custom food instead."
            ),
        )


@router.get("/{job_id}", response_model=AnalysisJobResponse)
def get_meal_analysis_job(
    job_id: str,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> AnalysisJobResponse:
    job = get_owned_analysis_job_or_none(db, user_id=current_user.id, job_id=job_id)
    if not job:
        raise_owner_scoped_not_found(
            db,
            request=http_request,
            user_id=current_user.id,
            detail="Meal analysis was not found.",
        )
    return serialize_analysis_job(job)


@router.delete("/{job_id}", response_model=AnalysisJobResponse)
def cancel_meal_analysis_job(
    job_id: str,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> AnalysisJobResponse:
    job = get_owned_analysis_job_or_none(db, user_id=current_user.id, job_id=job_id)
    if not job:
        raise_owner_scoped_not_found(
            db,
            request=http_request,
            user_id=current_user.id,
            detail="Meal analysis was not found.",
        )
    was_cancelled = cancel_analysis_job(job)
    cleanup_succeeded = delete_analysis_job_images(db, storage=storage, analysis_job_id=job.id)
    if was_cancelled:
        refund_ai_usage_record(db, record_id=job.ai_usage_record_id, reason="job_cancelled")
        record_audit_event(
            db,
            event_type="meal_analysis.cancel",
            user_id=current_user.id,
            request=http_request,
            outcome="cancelled",
        )
    elif job.status == "needs_review":
        # A review result is immutable, but the user can discard its private
        # inputs while retaking the meal. The result stays available only as
        # harmless structured review metadata until its normal expiry.
        record_audit_event(
            db,
            event_type="meal_analysis.review_inputs_discarded",
            user_id=current_user.id,
            request=http_request,
            outcome="deleted" if cleanup_succeeded else "cleanup_pending",
        )
    if not cleanup_succeeded:
        record_audit_event(
            db,
            event_type="meal_analysis.input_cleanup",
            user_id=current_user.id,
            request=http_request,
            outcome="cleanup_pending",
        )
    db.commit()
    return serialize_analysis_job(job)


@router.post("/jobs", response_model=AnalysisJobResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_meal_analysis_job(
    analysis_request: MealAnalysisJobCreateRequest,
    response: Response,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> AnalysisJobResponse:
    """Queue normalized private images for bounded, review-only analysis.

    The endpoint deliberately returns no analysis result. A worker owns the
    provider request and the user must still confirm the later result before a
    meal is persisted.
    """

    require_ai_features_enabled()

    resolved_key = resolve_idempotency_key(idempotency_key, analysis_request.idempotency_key)
    sanitized_images = sanitize_base64_images(analysis_request.analysis_images)
    safe_request_fingerprint = durable_job_fingerprint(
        sanitized_images,
        reference_plate_diameter_mm=analysis_request.reference_plate_diameter_mm,
    )
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=MEAL_ANALYSIS_JOB_OPERATION,
        idempotency_key=resolved_key,
        request_payload=safe_request_fingerprint,
        commit=False,
    )
    if reservation and reservation.is_replay:
        return AnalysisJobResponse.model_validate(reservation.replay_body)

    storage_keys: list[str] = []
    usage_reservation = None
    try:
        usage_reservation = reserve_ai_usage(
            db,
            user_id=current_user.id,
            operation=AI_OPERATION_MEAL_ANALYSIS,
            units=len(sanitized_images),
            idempotency_key=resolved_key,
        )
        retention_deadline = datetime.now(UTC) + timedelta(hours=settings.analysis_job_expiry_hours)
        for image in sanitized_images:
            storage_keys.append(
                storage.put(
                    owner_id=current_user.id,
                    purpose="analysis-job",
                    content=base64.b64decode(image, validate=True),
                )
            )
        job = create_queued_analysis_job(
            db,
            user_id=current_user.id,
            request_payload={
                "referencePlateDiameterMm": analysis_request.reference_plate_diameter_mm,
            },
            storage_keys=storage_keys,
            retention_deadline=retention_deadline,
            reference_plate_diameter_mm=analysis_request.reference_plate_diameter_mm,
            ai_usage_record=usage_reservation.record,
        )
        job.idempotency_key = hashed_job_idempotency_key(resolved_key)
        result = serialize_analysis_job(job)
        complete_idempotency_key(
            db,
            reservation,
            result,
            response_status=status.HTTP_202_ACCEPTED,
            resource_type="meal_analysis_job",
            resource_id=job.id,
            commit=True,
        )
    except Exception:
        for storage_key in storage_keys:
            try:
                storage.delete(storage_key)
            except Exception:
                # The scheduled retention worker can retry any persisted keys.
                pass
        if usage_reservation:
            refund_ai_usage(db, usage_reservation, reason="job_enqueue_failure")
        discard_idempotency_key(db, reservation)
        raise

    record_audit_event(
        db,
        event_type="meal_analysis.job_queued",
        user_id=current_user.id,
        request=http_request,
        outcome="queued",
    )
    db.commit()
    for name, value in quota_response_headers(usage_reservation.quota).items():
        response.headers[name] = value
    return result


@router.post("", response_model=MealAnalysisResult)
async def create_meal_analysis(
    analysis_request: MealAnalysisRequest,
    response: Response,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> MealAnalysisResult:
    # Analysis is paid, sensitive work. Require the same authenticated account
    # boundary as the later confirmation and meal-persistence workflow.
    require_ai_features_enabled()
    resolved_key = resolve_idempotency_key(idempotency_key, analysis_request.idempotency_key)
    payload = durable_job_fingerprint(
        analysis_request.analysis_images,
        reference_plate_diameter_mm=analysis_request.reference_plate_diameter_mm,
    )
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=MEAL_ANALYSIS_OPERATION,
        idempotency_key=resolved_key,
        request_payload=payload,
        commit=True,
    )

    if reservation and reservation.is_replay:
        return MealAnalysisResult.model_validate(reservation.replay_body)

    try:
        usage_reservation = reserve_ai_usage(
            db,
            user_id=current_user.id,
            operation=AI_OPERATION_MEAL_ANALYSIS,
            units=len(analysis_request.analysis_images),
            idempotency_key=resolved_key,
        )
    except AiQuotaExceededError:
        discard_idempotency_key(db, reservation)
        raise
    record_audit_event(
        db,
        event_type="ai.quota.reserve",
        user_id=current_user.id,
        request=http_request,
        outcome="reserved",
    )
    db.commit()
    for name, value in quota_response_headers(usage_reservation.quota).items():
        response.headers[name] = value

    try:
        result = await analyze_meal_photo(
            analysis_request.analysis_images,
            registry,
            reference_plate_diameter_mm=analysis_request.reference_plate_diameter_mm,
        )
    except Exception:
        refund_ai_usage(db, usage_reservation, reason="analysis_failure")
        record_audit_event(
            db,
            event_type="ai.quota.refund",
            user_id=current_user.id,
            request=http_request,
            outcome="analysis_failure",
        )
        discard_idempotency_key(db, reservation)
        raise

    settle_ai_usage(db, usage_reservation)
    record_audit_event(
        db,
        event_type="ai.quota.settle",
        user_id=current_user.id,
        request=http_request,
        outcome="settled",
    )
    complete_idempotency_key(
        db,
        reservation,
        result,
        response_status=status.HTTP_200_OK,
        resource_type="meal_analysis",
        resource_id=result.id,
        commit=True,
    )
    return result


def serialize_analysis_job(job: AnalysisJob) -> AnalysisJobResponse:
    result = MealAnalysisResult.model_validate(job.result_json) if job.result_json else None
    return AnalysisJobResponse(
        id=job.id,
        status=job.status,
        image_count=job.image_count,
        attempt_count=job.attempt_count,
        created_at=job.created_at,
        expires_at=job.expires_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        cancelled_at=job.cancelled_at,
        result=result,
        error_code=job.error_code,
    )


def durable_job_fingerprint(
    images: list[str],
    *,
    reference_plate_diameter_mm: float | None,
) -> dict[str, object]:
    """Create a keyed, non-reversible replay fingerprint for image input."""

    return {
        "imageCount": len(images),
        "imageDigests": [
            digest_sensitive_request_value(image)
            for image in images
        ],
        "referencePlateDiameterMm": reference_plate_diameter_mm,
    }


def hashed_job_idempotency_key(value: str | None) -> str | None:
    if not value:
        return None
    return hmac.new(settings.jwt_secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()
