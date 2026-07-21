"""Owner-scoped deletion and retention state for private meal images."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import AnalysisJob, AnalysisJobImage
from app.models.meal import Meal, MealImage
from app.storage import PrivateImageStorage


def get_owned_meal_image_or_none(db: Session, *, user_id: str, image_id: str) -> MealImage | None:
    return db.scalar(
        select(MealImage)
        .join(Meal, Meal.id == MealImage.meal_id)
        .where(MealImage.id == image_id, Meal.user_id == user_id, MealImage.deleted_at.is_(None))
    )


def delete_image(storage: PrivateImageStorage, image: MealImage | AnalysisJobImage, *, now: datetime | None = None) -> bool:
    """Delete storage first; preserve retry state if that irreversible action fails."""

    if image.deleted_at:
        return True
    image.deletion_attempts += 1
    try:
        storage.delete(image.storage_key)
    except Exception:  # Storage failures are intentionally recorded as a small code only.
        image.deletion_error_code = "storage_delete_failed"
        return False
    image.deleted_at = now or datetime.now(UTC)
    image.deletion_error_code = None
    return True


def copy_review_images_to_meal(
    db: Session,
    *,
    storage: PrivateImageStorage,
    analysis_job: AnalysisJob,
    meal: Meal,
    retention_deadline: datetime,
) -> list[MealImage]:
    """Copy temporary review inputs after explicit meal-level approval.

    Images are copied rather than reparented so a failed write never leaves a
    completed meal pointing at a job asset that its expiry worker may remove.
    Callers own the surrounding database transaction and must clean the
    temporary job inputs after a successful confirmation.
    """

    job_images = db.scalars(
        select(AnalysisJobImage)
        .where(
            AnalysisJobImage.analysis_job_id == analysis_job.id,
            AnalysisJobImage.deleted_at.is_(None),
        )
        .order_by(AnalysisJobImage.created_at.asc())
    ).all()
    if not job_images:
        raise ValueError("No private scan images are available for this review.")

    copied_keys: list[str] = []
    meal_images: list[MealImage] = []
    try:
        for image in job_images:
            copied_key = storage.put(
                owner_id=analysis_job.user_id,
                purpose="meal-image",
                content=storage.read(image.storage_key),
                suffix=suffix_for_content_type(image.content_type),
            )
            copied_keys.append(copied_key)
            meal_image = MealImage(
                meal_id=meal.id,
                storage_key=copied_key,
                capture_angle=image.capture_angle,
                content_type=image.content_type,
                metadata_removed=True,
                retention_deadline=retention_deadline,
            )
            db.add(meal_image)
            meal_images.append(meal_image)
        db.flush()
    except Exception:
        for copied_key in copied_keys:
            try:
                storage.delete(copied_key)
            except Exception:
                # The keys do not have database records yet, so they cannot be
                # retried by the worker. This exception path is operationally
                # surfaced to the caller and should remain exceptionally rare.
                pass
        raise

    return meal_images


def delete_analysis_job_images(db: Session, *, storage: PrivateImageStorage, analysis_job_id: str) -> bool:
    """Best-effort cleanup that keeps retry metadata when object deletion fails."""

    images = db.scalars(
        select(AnalysisJobImage).where(
            AnalysisJobImage.analysis_job_id == analysis_job_id,
            AnalysisJobImage.deleted_at.is_(None),
        )
    ).all()
    # Do not short-circuit after one storage failure. Every selected image gets
    # a deletion attempt and durable retry state in the same bounded pass.
    outcomes = [delete_image(storage, image) for image in images]
    return all(outcomes)


def suffix_for_content_type(content_type: str) -> str:
    return {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
    }.get(content_type.lower(), ".jpg")


def expire_due_images(db: Session, storage: PrivateImageStorage, *, now: datetime | None = None, limit: int = 100) -> int:
    timestamp = now or datetime.now(UTC)
    meal_images = db.scalars(
        select(MealImage)
        .where(MealImage.deleted_at.is_(None), MealImage.retention_deadline.is_not(None), MealImage.retention_deadline <= timestamp)
        .order_by(MealImage.retention_deadline.asc())
        .limit(limit)
    ).all()
    job_images = db.scalars(
        select(AnalysisJobImage)
        .where(
            AnalysisJobImage.deleted_at.is_(None),
            AnalysisJobImage.retention_deadline <= timestamp,
        )
        .order_by(AnalysisJobImage.retention_deadline.asc())
        .limit(limit)
    ).all()
    # Each source gets its own bounded batch so abandoned analysis inputs do
    # not starve already-logged meal-image cleanup.
    deleted = sum(delete_image(storage, image, now=timestamp) for image in (*meal_images, *job_images))
    db.commit()
    return deleted
