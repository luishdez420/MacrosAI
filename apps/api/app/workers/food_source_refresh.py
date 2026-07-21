"""Bounded refresh worker for stale external nutrition-source records.

The worker deliberately uses the request-path refresh lease and exponential
backoff. It never refreshes user-created foods, search queries, or immutable
meal snapshots, and a provider failure leaves the current stale record usable.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.v1.food_routes import (
    STALE_SOURCE_RECORD_DAYS,
    refresh_stale_source_record,
)
from app.core.config import settings
from app.core.logging import configure_logging
from app.core.metrics import metrics
from app.db.session import SessionLocal
from app.models.food import FoodSourceRecord
from app.nutrition.provider_registry import NutritionProviderRegistry, get_provider_registry
from app.schemas.food import ProviderName

logger = structlog.get_logger(__name__)


async def run_once(
    *,
    session_factory: Callable[[], Session] = SessionLocal,
    registry: NutritionProviderRegistry | None = None,
    batch_size: int | None = None,
) -> int:
    """Refresh at most one bounded stale batch and return records considered.

    Candidates are selected by oldest source retrieval and must be eligible for
    the existing refresh lease. A fresh session per record isolates failures so
    a malformed source record or transient provider issue cannot stop a sweep.
    """

    limit = settings.food_source_refresh_worker_batch_size if batch_size is None else batch_size
    source_record_ids = select_due_source_record_ids(session_factory=session_factory, limit=limit)
    active_registry = registry or get_provider_registry()

    for source_record_id in source_record_ids:
        db = session_factory()
        try:
            source_record = db.get(FoodSourceRecord, source_record_id)
            if source_record is None:
                continue
            await refresh_stale_source_record(
                source_record,
                db,
                active_registry,
                operation="scheduled_refresh",
            )
        except Exception:
            db.rollback()
            metrics.record_food_cache_event(
                cache="source_record",
                operation="scheduled_refresh",
                outcome="worker_error",
            )
            # Do not log food IDs, provider IDs, queries, or barcodes.
            logger.exception("food_source_refresh_record_failed")
        finally:
            db.close()

    return len(source_record_ids)


def select_due_source_record_ids(*, session_factory: Callable[[], Session], limit: int) -> list[str]:
    """Return stale provider-record IDs eligible for the shared refresh lease."""

    now = datetime.now(timezone.utc)
    stale_before = now - timedelta(days=STALE_SOURCE_RECORD_DAYS)
    db = session_factory()
    try:
        return list(
            db.scalars(
                select(FoodSourceRecord.id)
                .where(
                    FoodSourceRecord.provider != ProviderName.user,
                    FoodSourceRecord.retrieved_at.is_not(None),
                    FoodSourceRecord.retrieved_at <= stale_before,
                    or_(
                        FoodSourceRecord.refresh_not_before.is_(None),
                        FoodSourceRecord.refresh_not_before <= now,
                    ),
                )
                .order_by(FoodSourceRecord.retrieved_at.asc(), FoodSourceRecord.id.asc())
                .limit(limit)
            ).all()
        )
    finally:
        db.close()


def main() -> None:
    configure_logging()
    logger.info(
        "food_source_refresh_worker_started",
        poll_seconds=settings.food_source_refresh_worker_poll_seconds,
        batch_size=settings.food_source_refresh_worker_batch_size,
    )

    while True:
        try:
            considered = asyncio.run(run_once())
            logger.info("food_source_refresh_sweep_complete", considered_count=considered)
        except Exception:
            logger.exception("food_source_refresh_sweep_failed")
        time.sleep(settings.food_source_refresh_worker_poll_seconds)


if __name__ == "__main__":  # pragma: no cover - exercised through run_once.
    main()
