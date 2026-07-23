"""Bounded durable meal-analysis worker.

This process owns provider execution for queued jobs. It persists only the
structured result that a user must review; it never creates a meal itself.
"""

from __future__ import annotations

import asyncio
import base64
import time
from collections.abc import Callable

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.meal_analyzer import analyze_meal_photo
from app.core.ai_quota import (
    refund_ai_usage_record,
    renew_ai_usage_record,
    settle_ai_usage_record,
)
from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal
from app.models.analysis import AnalysisJob, AnalysisJobImage
from app.nutrition.provider_registry import NutritionProviderRegistry, get_provider_registry
from app.services.analysis_jobs import (
    PROCESSING,
    claim_next_analysis_job,
    complete_analysis_job,
    fail_analysis_job,
)
from app.services.image_lifecycle import delete_image
from app.services.worker_heartbeats import MEAL_ANALYSIS_WORKER, heartbeat_worker
from app.storage import PrivateImageStorage, build_private_image_storage
from app.workers.startup import ensure_worker_database_ready

logger = structlog.get_logger(__name__)


class AnalysisJobNoLongerActiveError(RuntimeError):
    """Raised when cancellation wins before provider work begins."""


async def run_once(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    storage: PrivateImageStorage | None = None,
    registry: NutritionProviderRegistry | None = None,
) -> bool:
    """Claim and process one job, returning whether work was found."""

    heartbeat_worker(MEAL_ANALYSIS_WORKER, session_factory=session_factory)
    active_storage = storage or build_private_image_storage()
    active_registry = registry or get_provider_registry()
    db = session_factory()
    try:
        claim = claim_next_analysis_job(db)
        if not claim:
            return False
        job_id = claim.job.id
        if claim.job.ai_usage_record_id and not renew_ai_usage_record(
            db, record_id=claim.job.ai_usage_record_id
        ):
            fail_analysis_job(claim.job, error_code="analysis_quota_unavailable")
            clean_job_inputs(db, storage=active_storage, job_id=job_id)
            db.commit()
            logger.info("meal_analysis_job_quota_unavailable", job_id=job_id)
            return True
        db.commit()  # Persist the lease before calling external services.
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    try:
        image_base64s, reference_plate_diameter_mm = read_job_input(
            session_factory=session_factory,
            storage=active_storage,
            job_id=job_id,
        )
        result = await analyze_meal_photo(
            image_base64s,
            active_registry,
            reference_plate_diameter_mm=reference_plate_diameter_mm,
        )
    except Exception as exc:
        finalize_failure(
            session_factory=session_factory,
            storage=active_storage,
            job_id=job_id,
            error_code=worker_error_code(exc),
        )
        return True

    finalize_success(
        session_factory=session_factory,
        storage=active_storage,
        job_id=job_id,
        result=result.model_dump(mode="json"),
    )
    return True


def read_job_input(
    *,
    session_factory: Callable[[], Session],
    storage: PrivateImageStorage,
    job_id: str,
) -> tuple[list[str], float | None]:
    db = session_factory()
    try:
        job = db.get(AnalysisJob, job_id)
        if not job:
            raise RuntimeError("analysis_job_missing")
        if job.status != PROCESSING:
            # A user may cancel after this worker claimed the job. Do not send
            # a photo to a provider once that cancellation has been persisted.
            raise AnalysisJobNoLongerActiveError("analysis_job_not_processing")
        images = db.scalars(
            select(AnalysisJobImage)
            .where(AnalysisJobImage.analysis_job_id == job_id, AnalysisJobImage.deleted_at.is_(None))
            .order_by(AnalysisJobImage.created_at.asc())
        ).all()
        if not images:
            raise RuntimeError("analysis_input_missing")
        return (
            [base64.b64encode(storage.read(image.storage_key)).decode("ascii") for image in images],
            job.reference_plate_diameter_mm,
        )
    finally:
        db.close()


def finalize_success(
    *,
    session_factory: Callable[[], Session],
    storage: PrivateImageStorage,
    job_id: str,
    result: dict,
) -> None:
    db = session_factory()
    try:
        job = db.get(AnalysisJob, job_id)
        if not job:
            return
        completed = complete_analysis_job(job, result=result)
        if completed:
            settle_ai_usage_record(db, record_id=job.ai_usage_record_id)
        # Keep normalized inputs only through the existing short-lived review
        # window. Confirmation either deletes them or copies them into an
        # explicitly requested, owner-scoped meal-image record.
        db.commit()
        logger.info("meal_analysis_job_completed", job_id=job_id, status=job.status)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def finalize_failure(
    *,
    session_factory: Callable[[], Session],
    storage: PrivateImageStorage,
    job_id: str,
    error_code: str,
) -> None:
    db = session_factory()
    try:
        job = db.get(AnalysisJob, job_id)
        if not job:
            return
        failed = fail_analysis_job(job, error_code=error_code)
        if failed:
            refund_ai_usage_record(db, record_id=job.ai_usage_record_id, reason=error_code)
        clean_job_inputs(db, storage=storage, job_id=job_id)
        db.commit()
        logger.info("meal_analysis_job_failed", job_id=job_id, error_code=error_code, status=job.status)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def clean_job_inputs(db: Session, *, storage: PrivateImageStorage, job_id: str) -> None:
    """Best-effort immediate cleanup; retained metadata lets the sweeper retry."""

    images = db.scalars(
        select(AnalysisJobImage).where(
            AnalysisJobImage.analysis_job_id == job_id,
            AnalysisJobImage.deleted_at.is_(None),
        )
    ).all()
    for image in images:
        delete_image(storage, image)


def worker_error_code(error: Exception) -> str:
    if isinstance(error, HTTPException):
        if error.status_code == 503:
            return "analysis_unavailable"
        if error.status_code in {400, 413}:
            return "invalid_analysis_input"
    return "analysis_failed"


def main() -> None:
    configure_logging()
    ensure_worker_database_ready()
    storage = build_private_image_storage()
    logger.info("meal_analysis_worker_started", poll_seconds=settings.analysis_job_worker_poll_seconds)
    while True:
        try:
            processed = asyncio.run(run_once(storage=storage))
            if not processed:
                time.sleep(settings.analysis_job_worker_poll_seconds)
        except Exception:
            logger.exception("meal_analysis_worker_iteration_failed")
            time.sleep(settings.analysis_job_worker_poll_seconds)


if __name__ == "__main__":  # pragma: no cover - process entry point.
    main()
