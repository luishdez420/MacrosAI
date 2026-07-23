from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.worker import WorkerHeartbeat
from app.services.worker_heartbeats import (
    FOOD_SOURCE_REFRESH_WORKER,
    IMAGE_RETENTION_WORKER,
    MEAL_ANALYSIS_WORKER,
    background_worker_health,
    expire_stale_worker_heartbeats,
    record_worker_heartbeat,
)
import app.models as _models  # noqa: F401


def test_worker_health_requires_every_configured_worker_without_exposing_instances() -> None:
    factory = create_test_session_factory()
    now = datetime.now(UTC)
    with factory() as db:
        record_worker_heartbeat(
            db,
            worker_name=MEAL_ANALYSIS_WORKER,
            instance_id="analysis-instance",
            now=now,
        )
        record_worker_heartbeat(
            db,
            worker_name=IMAGE_RETENTION_WORKER,
            instance_id="retention-instance",
            now=now,
        )
        db.commit()

    incomplete = background_worker_health(
        session_factory=factory,
        now=now,
        required=True,
        ttl_seconds=60,
    )
    assert incomplete.healthy is False
    assert incomplete.workers == {
        MEAL_ANALYSIS_WORKER: True,
        IMAGE_RETENTION_WORKER: True,
        FOOD_SOURCE_REFRESH_WORKER: False,
    }
    assert "analysis-instance" not in str(incomplete.to_response())

    with factory() as db:
        record_worker_heartbeat(
            db,
            worker_name=FOOD_SOURCE_REFRESH_WORKER,
            instance_id="refresh-instance",
            now=now,
        )
        db.commit()

    healthy = background_worker_health(
        session_factory=factory,
        now=now,
        required=True,
        ttl_seconds=60,
    )
    assert healthy.healthy is True
    assert healthy.backend == "database"


def test_stale_heartbeats_are_not_healthy_and_are_cleaned_in_bounded_batches() -> None:
    factory = create_test_session_factory()
    now = datetime.now(UTC)
    with factory() as db:
        for index in range(2):
            db.add(
                WorkerHeartbeat(
                    worker_name=MEAL_ANALYSIS_WORKER,
                    instance_id=f"expired-{index}",
                    last_seen_at=now - timedelta(hours=index + 2),
                )
            )
        db.add(
            WorkerHeartbeat(
                worker_name=IMAGE_RETENTION_WORKER,
                instance_id="fresh",
                last_seen_at=now,
            )
        )
        db.commit()

        assert expire_stale_worker_heartbeats(
            db,
            now=now,
            retention_seconds=3_600,
            limit=1,
        ) == 1
        db.commit()
        assert db.query(WorkerHeartbeat).count() == 2

        assert expire_stale_worker_heartbeats(
            db,
            now=now,
            retention_seconds=3_600,
            limit=10,
        ) == 1
        db.commit()
        remaining = db.query(WorkerHeartbeat).all()
        assert [(entry.worker_name, entry.instance_id) for entry in remaining] == [
            (IMAGE_RETENTION_WORKER, "fresh")
        ]

    report = background_worker_health(
        session_factory=factory,
        now=now,
        required=True,
        ttl_seconds=60,
    )
    assert report.healthy is False
    assert report.workers[IMAGE_RETENTION_WORKER] is True
    assert report.workers[MEAL_ANALYSIS_WORKER] is False


def test_repeated_process_heartbeat_updates_one_record() -> None:
    factory = create_test_session_factory()
    first_seen = datetime.now(UTC) - timedelta(minutes=1)
    second_seen = datetime.now(UTC)
    with factory() as db:
        record_worker_heartbeat(
            db,
            worker_name=MEAL_ANALYSIS_WORKER,
            instance_id="one-process",
            now=first_seen,
        )
        db.commit()
        record_worker_heartbeat(
            db,
            worker_name=MEAL_ANALYSIS_WORKER,
            instance_id="one-process",
            now=second_seen,
        )
        db.commit()

        rows = db.query(WorkerHeartbeat).all()
        assert len(rows) == 1
        persisted_seen = rows[0].last_seen_at
        if persisted_seen.tzinfo is None:  # SQLite does not round-trip timezone metadata.
            persisted_seen = persisted_seen.replace(tzinfo=UTC)
        assert persisted_seen == second_seen


def create_test_session_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)
