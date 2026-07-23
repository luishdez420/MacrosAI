"""Shared database-readiness checks for independently started workers."""

from __future__ import annotations

import structlog

from app.core.config import settings
from app.db.health import database_health
from app.db.migrations import run_database_migrations

logger = structlog.get_logger(__name__)


class WorkerDatabaseNotReadyError(RuntimeError):
    """Raised when a worker would otherwise start against an incomplete schema."""


def ensure_worker_database_ready() -> None:
    """Ensure a worker never enters its polling loop against an old database.

    Phone preview intentionally uses SQLite and may retain data across schema
    additions. When its explicit auto-migration setting is enabled, repair that
    additive schema before the worker writes a heartbeat. Production workers
    still rely on their deployment's Alembic step and fail once, clearly, if it
    was skipped rather than continuously logging database errors.
    """

    health = database_health()
    if health.get("schemaReady"):
        return

    if settings.auto_migrate_on_startup:
        logger.info("worker_database_schema_migration_start")
        run_database_migrations()
        health = database_health()
        if health.get("schemaReady"):
            logger.info("worker_database_schema_migration_complete")
            return

    raise WorkerDatabaseNotReadyError(
        "Worker database schema is not ready. Start local preview with npm run dev:phone "
        "or run the deployment Alembic migration before starting workers."
    )
