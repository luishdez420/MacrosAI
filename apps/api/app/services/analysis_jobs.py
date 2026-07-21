"""Durable, owner-scoped state transitions for meal-analysis jobs.

Jobs contain only sanitized input metadata and a structured review result. A
completed job is never a meal; persistence remains an explicit separate user
confirmation action.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.analysis import AnalysisJob, AnalysisJobImage
from app.models.usage import AiUsageRecord

QUEUED = "queued"
PROCESSING = "processing"
NEEDS_REVIEW = "needs_review"
FAILED = "failed"
CANCELLED = "cancelled"
EXPIRED = "expired"
TERMINAL_STATUSES = frozenset({NEEDS_REVIEW, FAILED, CANCELLED, EXPIRED})


@dataclass(frozen=True)
class JobClaim:
    job: AnalysisJob
    was_reclaimed: bool


def create_queued_analysis_job(
    db: Session,
    *,
    user_id: str,
    request_payload: dict,
    storage_keys: list[str],
    retention_deadline: datetime,
    reference_plate_diameter_mm: float | None,
    ai_usage_record: AiUsageRecord | None = None,
    now: datetime | None = None,
) -> AnalysisJob:
    """Persist a queued review job after private image writes have succeeded.

    Callers own deletion of the just-written keys if this transaction fails.
    The request payload must contain only safe analysis settings, never image data.
    """

    timestamp = now or datetime.now(UTC)
    job = AnalysisJob(
        user_id=user_id,
        status=QUEUED,
        request_payload_json=request_payload,
        ai_usage_record_id=ai_usage_record.id if ai_usage_record else None,
        image_count=len(storage_keys),
        reference_plate_diameter_mm=reference_plate_diameter_mm,
        expires_at=timestamp + timedelta(hours=settings.analysis_job_expiry_hours),
    )
    db.add(job)
    db.flush()
    db.add_all(
        AnalysisJobImage(
            analysis_job_id=job.id,
            storage_key=storage_key,
            retention_deadline=retention_deadline,
        )
        for storage_key in storage_keys
    )
    db.flush()
    return job


def get_owned_analysis_job_or_none(db: Session, *, user_id: str, job_id: str) -> AnalysisJob | None:
    return db.scalar(select(AnalysisJob).where(AnalysisJob.id == job_id, AnalysisJob.user_id == user_id))


def claim_next_analysis_job(db: Session, *, now: datetime | None = None) -> JobClaim | None:
    """Claim one queued or abandoned job without exposing it across accounts."""

    timestamp = now or datetime.now(UTC)
    statement: Select[tuple[AnalysisJob]] = (
        select(AnalysisJob)
        .where(
            (AnalysisJob.status == QUEUED)
            | ((AnalysisJob.status == PROCESSING) & (AnalysisJob.lease_expires_at.is_not(None)) & (AnalysisJob.lease_expires_at <= timestamp))
        )
        .where((AnalysisJob.expires_at.is_(None)) | (AnalysisJob.expires_at > timestamp))
        .order_by(AnalysisJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    job = db.scalar(statement)
    if not job:
        return None

    was_reclaimed = job.status == PROCESSING
    job.status = PROCESSING
    job.attempt_count += 1
    job.started_at = timestamp
    job.lease_expires_at = timestamp + timedelta(seconds=settings.analysis_job_lease_seconds)
    job.error_code = None
    job.error_message = None
    db.flush()
    return JobClaim(job=job, was_reclaimed=was_reclaimed)


def cancel_analysis_job(job: AnalysisJob, *, now: datetime | None = None) -> bool:
    """Cancel an outstanding job. Terminal results cannot be retroactively changed."""

    if job.status in TERMINAL_STATUSES:
        return False
    job.status = CANCELLED
    job.cancelled_at = now or datetime.now(UTC)
    job.lease_expires_at = None
    return True


def complete_analysis_job(job: AnalysisJob, *, result: dict, now: datetime | None = None) -> bool:
    """Persist a review-only result unless the owner cancelled while it ran."""

    if job.status == CANCELLED:
        return False
    timestamp = now or datetime.now(UTC)
    job.status = NEEDS_REVIEW
    job.result_json = result
    job.completed_at = timestamp
    job.lease_expires_at = None
    return True


def fail_analysis_job(job: AnalysisJob, *, error_code: str, now: datetime | None = None) -> bool:
    if job.status == CANCELLED:
        return False
    job.status = FAILED
    job.error_code = error_code[:64]
    # User-facing routes map codes to safe generic guidance; provider internals
    # and image-derived details must not be persisted in the job error state.
    job.error_message = None
    job.completed_at = now or datetime.now(UTC)
    job.lease_expires_at = None
    return True


def expire_analysis_jobs(db: Session, *, now: datetime | None = None, limit: int = 100) -> int:
    timestamp = now or datetime.now(UTC)
    jobs = db.scalars(
        select(AnalysisJob)
        .where(
            AnalysisJob.status.in_((QUEUED, PROCESSING)),
            AnalysisJob.expires_at.is_not(None),
            AnalysisJob.expires_at <= timestamp,
        )
        .order_by(AnalysisJob.expires_at.asc())
        .limit(limit)
    ).all()
    for job in jobs:
        job.status = EXPIRED
        job.lease_expires_at = None
        job.completed_at = timestamp
    db.flush()
    return len(jobs)
