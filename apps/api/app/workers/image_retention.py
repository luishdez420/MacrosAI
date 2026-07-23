"""Scheduled enforcement for private asset and audit retention deadlines.

The worker deliberately owns no HTTP surface. It can be run as a separate
process, so an image-storage outage cannot block API request handling.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import structlog
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.ai_quota import expire_stale_ai_usage_reservations
from app.core.logging import configure_logging
from app.core.metrics import metrics
from app.db.session import SessionLocal
from app.services.analysis_jobs import expire_analysis_jobs
from app.services.audit_delivery import (
    AuditDeliverySink,
    build_audit_delivery_sink,
    deliver_pending_audit_events,
)
from app.services.audit_lifecycle import expire_audit_logs
from app.services.image_lifecycle import expire_due_images
from app.services.idempotency_lifecycle import expire_idempotency_records
from app.services.worker_heartbeats import (
    IMAGE_RETENTION_WORKER,
    expire_stale_worker_heartbeats,
    heartbeat_worker,
)
from app.storage import PrivateImageStorage, build_private_image_storage
from app.workers.startup import ensure_worker_database_ready

logger = structlog.get_logger(__name__)


def run_once(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    storage: PrivateImageStorage | None = None,
    audit_retention_days: int | None = None,
    audit_delivery_sink: AuditDeliverySink | None = None,
) -> int:
    """Process a bounded retention batch and always close its database session."""

    heartbeat_worker(IMAGE_RETENTION_WORKER, session_factory=session_factory)
    db = session_factory()
    try:
        sink = audit_delivery_sink if audit_delivery_sink is not None else build_audit_delivery_sink()
        delivered_audit_events, retried_audit_events = (
            deliver_pending_audit_events(db, sink=sink) if sink is not None else (0, 0)
        )
        deleted_images = expire_due_images(db, storage or build_private_image_storage())
        expired_jobs = expire_analysis_jobs(db)
        expired_idempotency_records = expire_idempotency_records(db)
        expired_ai_reservations = expire_stale_ai_usage_reservations(db)
        expired_worker_heartbeats = expire_stale_worker_heartbeats(db)
        configured_audit_retention = (
            settings.audit_log_retention_days
            if audit_retention_days is None
            else audit_retention_days
        )
        expired_audit_logs = (
            expire_audit_logs(db, retention_days=configured_audit_retention)
            if configured_audit_retention is not None
            else 0
        )
        db.commit()
        if expired_jobs:
            logger.info("analysis_job_expiry_sweep_complete", expired_count=expired_jobs)
        if configured_audit_retention is not None:
            metrics.record_audit_retention_event(
                outcome="purged" if expired_audit_logs else "no_expired_events"
            )
            logger.info(
                "audit_retention_sweep_complete",
                deleted_count=expired_audit_logs,
                retention_days=configured_audit_retention,
            )
        metrics.record_idempotency_retention_event(
            outcome="purged" if expired_idempotency_records else "no_expired_records"
        )
        logger.info(
            "idempotency_retention_sweep_complete",
            deleted_count=expired_idempotency_records,
        )
        metrics.record_ai_quota_reconciliation_event(
            outcome="expired" if expired_ai_reservations else "no_expired_reservations"
        )
        logger.info(
            "ai_quota_reservation_reconciliation_complete",
            expired_count=expired_ai_reservations,
        )
        if expired_worker_heartbeats:
            logger.info(
                "background_worker_heartbeat_retention_complete",
                deleted_count=expired_worker_heartbeats,
            )
        if sink is not None:
            metrics.record_audit_delivery_event(
                outcome="delivered" if delivered_audit_events else "no_pending_events"
            )
            if retried_audit_events:
                metrics.record_audit_delivery_event(outcome="retry_scheduled")
            logger.info(
                "audit_delivery_sweep_complete",
                delivered_count=delivered_audit_events,
                retry_count=retried_audit_events,
            )
        return deleted_images
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    configure_logging()
    ensure_worker_database_ready()
    storage = build_private_image_storage()
    logger.info(
        "meal_image_retention_worker_started",
        storage_backend=settings.image_storage_backend,
        poll_seconds=settings.image_retention_worker_poll_seconds,
        audit_retention_days=settings.audit_log_retention_days,
        audit_delivery_backend=settings.audit_delivery_backend,
    )

    while True:
        try:
            deleted = run_once(storage=storage)
            logger.info("meal_image_retention_sweep_complete", deleted_count=deleted)
        except Exception:
            # The service persists per-image retry state when the storage delete
            # fails. Keep the worker alive to retry on its next bounded sweep.
            logger.exception("meal_image_retention_sweep_failed")
        time.sleep(settings.image_retention_worker_poll_seconds)


if __name__ == "__main__":  # pragma: no cover - exercised through the process entry point.
    main()
