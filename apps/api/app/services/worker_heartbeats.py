"""Bounded, privacy-safe heartbeat reporting for background workers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.worker import WorkerHeartbeat

MEAL_ANALYSIS_WORKER = "meal_analysis"
IMAGE_RETENTION_WORKER = "image_retention"
FOOD_SOURCE_REFRESH_WORKER = "food_source_refresh"
REQUIRED_WORKERS = (
    MEAL_ANALYSIS_WORKER,
    IMAGE_RETENTION_WORKER,
    FOOD_SOURCE_REFRESH_WORKER,
)

# A random identifier stays stable only for the current Python process. It is
# sufficient to distinguish replicas without persisting host or device data.
PROCESS_INSTANCE_ID = str(uuid4())


@dataclass(frozen=True)
class WorkerHealthReport:
    """Aggregate worker status suitable for readiness responses and metrics."""

    required: bool
    healthy: bool
    backend: str
    workers: dict[str, bool]

    def to_response(self) -> dict[str, object]:
        return {
            "required": self.required,
            "healthy": self.healthy,
            "backend": self.backend,
            "workers": self.workers,
        }


def record_worker_heartbeat(
    db: Session,
    *,
    worker_name: str,
    now: datetime | None = None,
    instance_id: str = PROCESS_INSTANCE_ID,
) -> None:
    """Create or refresh one worker's current process heartbeat.

    Callers own the transaction to keep a heartbeat and the worker's ordinary
    database operation independently retryable.
    """

    validate_worker_name(worker_name)
    seen_at = now or datetime.now(UTC)
    heartbeat = db.scalar(
        select(WorkerHeartbeat).where(
            WorkerHeartbeat.worker_name == worker_name,
            WorkerHeartbeat.instance_id == instance_id,
        )
    )
    if heartbeat is None:
        db.add(
            WorkerHeartbeat(
                worker_name=worker_name,
                instance_id=instance_id,
                last_seen_at=seen_at,
            )
        )
    else:
        heartbeat.last_seen_at = seen_at


def heartbeat_worker(
    worker_name: str,
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    now: datetime | None = None,
) -> None:
    """Persist liveness in a short independent transaction before work starts."""

    db = session_factory()
    try:
        record_worker_heartbeat(db, worker_name=worker_name, now=now)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def background_worker_health(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    now: datetime | None = None,
    required: bool | None = None,
    ttl_seconds: int | None = None,
) -> WorkerHealthReport:
    """Return aggregate required-worker liveness without exposing instances."""

    requirement = settings.background_worker_heartbeats_required if required is None else required
    timeout = settings.background_worker_heartbeat_ttl_seconds if ttl_seconds is None else ttl_seconds
    cutoff = (now or datetime.now(UTC)) - timedelta(seconds=timeout)
    db = session_factory()
    try:
        active_names = set(
            db.scalars(
                select(WorkerHeartbeat.worker_name)
                .where(
                    WorkerHeartbeat.worker_name.in_(REQUIRED_WORKERS),
                    WorkerHeartbeat.last_seen_at >= cutoff,
                )
                .distinct()
            ).all()
        )
    except SQLAlchemyError:
        return WorkerHealthReport(
            required=requirement,
            healthy=not requirement,
            backend="database_unavailable",
            workers={worker_name: False for worker_name in REQUIRED_WORKERS},
        )
    finally:
        db.close()

    workers = {worker_name: worker_name in active_names for worker_name in REQUIRED_WORKERS}
    return WorkerHealthReport(
        required=requirement,
        healthy=all(workers.values()) if requirement else True,
        backend="database",
        workers=workers,
    )


def expire_stale_worker_heartbeats(
    db: Session,
    *,
    now: datetime | None = None,
    retention_seconds: int | None = None,
    limit: int = 500,
) -> int:
    """Delete an oldest-first bounded batch of stale operational rows."""

    retention = retention_seconds or settings.background_worker_heartbeat_retention_seconds
    cutoff = (now or datetime.now(UTC)) - timedelta(seconds=retention)
    ids = list(
        db.scalars(
            select(WorkerHeartbeat.id)
            .where(WorkerHeartbeat.last_seen_at <= cutoff)
            .order_by(WorkerHeartbeat.last_seen_at.asc(), WorkerHeartbeat.id.asc())
            .limit(limit)
        ).all()
    )
    if not ids:
        return 0

    db.execute(delete(WorkerHeartbeat).where(WorkerHeartbeat.id.in_(ids)))
    return len(ids)


def validate_worker_name(worker_name: str) -> None:
    if worker_name not in REQUIRED_WORKERS:
        raise ValueError("Unknown background worker name.")
