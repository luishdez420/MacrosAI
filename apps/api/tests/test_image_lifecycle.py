from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.audit import record_audit_event
from app.db.base import Base
from app.models.meal import Meal, MealImage
from app.models.analysis import AnalysisJob, AnalysisJobImage
from app.models.user import AuditDelivery, AuditLog, User
from app.services.audit_lifecycle import expire_audit_logs
from app.services.image_lifecycle import (
    delete_analysis_job_images,
    delete_image,
    expire_due_images,
    get_owned_meal_image_or_none,
)
from app.workers.image_retention import run_once
import app.models as _models  # noqa: F401


def test_image_lifecycle_is_owner_scoped_and_retries_failed_storage_delete() -> None:
    db = session()
    owner, other = User(email="owner@example.com"), User(email="other@example.com")
    db.add_all([owner, other])
    db.flush()
    image = MealImage(meal=Meal(user_id=owner.id, name="Lunch"), storage_key="meal/owner/image.jpg")
    db.add(image)
    db.commit()

    assert get_owned_meal_image_or_none(db, user_id=other.id, image_id=image.id) is None
    assert delete_image(FailingStorage(), image) is False
    assert image.deleted_at is None
    assert image.deletion_attempts == 1
    assert image.deletion_error_code == "storage_delete_failed"
    assert delete_image(WorkingStorage(), image) is True
    assert image.deleted_at is not None


def test_due_image_expiration_deletes_only_due_assets() -> None:
    db = session()
    user = User(email="retention@example.com")
    db.add(user)
    db.flush()
    now = datetime.now(UTC)
    due = MealImage(meal=Meal(user_id=user.id, name="Due"), storage_key="due.jpg", retention_deadline=now - timedelta(seconds=1))
    later = MealImage(meal=Meal(user_id=user.id, name="Later"), storage_key="later.jpg", retention_deadline=now + timedelta(days=1))
    db.add_all([due, later])
    db.commit()

    assert expire_due_images(db, WorkingStorage(), now=now) == 1
    assert due.deleted_at is not None
    assert later.deleted_at is None


def test_due_image_expiration_also_cleans_private_analysis_inputs() -> None:
    db = session()
    user = User(email="analysis-retention@example.com")
    db.add(user)
    db.flush()
    now = datetime.now(UTC)
    job = AnalysisJob(user_id=user.id, status="queued")
    db.add(job)
    db.flush()
    image = AnalysisJobImage(
        analysis_job_id=job.id,
        storage_key="analysis-job/due.jpg",
        retention_deadline=now - timedelta(seconds=1),
    )
    db.add(image)
    db.commit()

    assert expire_due_images(db, WorkingStorage(), now=now) == 1
    assert image.deleted_at is not None


def test_analysis_input_cleanup_attempts_every_image_when_one_delete_fails() -> None:
    db = session()
    user = User(email="analysis-cleanup@example.com")
    db.add(user)
    db.flush()
    job = AnalysisJob(user_id=user.id, status="needs_review")
    db.add(job)
    db.flush()
    failed = AnalysisJobImage(
        analysis_job_id=job.id,
        storage_key="analysis-job/fail.jpg",
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
    )
    succeeded = AnalysisJobImage(
        analysis_job_id=job.id,
        storage_key="analysis-job/succeed.jpg",
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
    )
    db.add_all((failed, succeeded))
    db.commit()
    storage = SelectiveFailingStorage(failed_key=failed.storage_key)

    assert delete_analysis_job_images(db, storage=storage, analysis_job_id=job.id) is False
    assert set(storage.attempted_keys) == {failed.storage_key, succeeded.storage_key}
    assert failed.deleted_at is None
    assert failed.deletion_attempts == 1
    assert failed.deletion_error_code == "storage_delete_failed"
    assert succeeded.deleted_at is not None


def test_retention_worker_processes_due_images_and_closes_its_session() -> None:
    db = session()
    user = User(email="worker@example.com")
    db.add(user)
    db.flush()
    db.add(
        MealImage(
            meal=Meal(user_id=user.id, name="Due"),
            storage_key="worker-due.jpg",
            retention_deadline=datetime.now(UTC) - timedelta(seconds=1),
        )
    )
    db.commit()

    factory = SessionFactory(db)

    assert run_once(session_factory=factory, storage=WorkingStorage()) == 1
    assert factory.closed is True


def test_retention_worker_expires_due_analysis_jobs() -> None:
    db = session()
    user = User(email="expired-analysis-job@example.com")
    db.add(user)
    db.flush()
    job = AnalysisJob(
        user_id=user.id,
        status="queued",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    db.add(job)
    db.commit()
    job_id = job.id

    assert run_once(session_factory=SessionFactory(db), storage=WorkingStorage()) == 0
    assert db.get(AnalysisJob, job_id).status == "expired"


def test_audit_retention_deletes_only_expired_minimal_events_in_bounded_batches() -> None:
    db = session()
    now = datetime.now(UTC)
    old_events = [
        AuditLog(event_type="auth.login", created_at=now - timedelta(days=31)),
        AuditLog(event_type="auth.logout", created_at=now - timedelta(days=30, seconds=1)),
    ]
    retained_event = AuditLog(event_type="auth.refresh", created_at=now - timedelta(days=29))
    db.add_all([*old_events, retained_event])
    db.flush()
    db.add_all(
        [
            AuditDelivery(audit_log_id=event.id, status="delivered", delivered_at=now)
            for event in (*old_events, retained_event)
        ]
    )
    db.commit()
    first_old_event_id = old_events[0].id
    second_old_event_id = old_events[1].id
    retained_event_id = retained_event.id

    assert expire_audit_logs(db, retention_days=30, now=now, limit=1) == 1
    db.commit()
    assert db.get(AuditLog, first_old_event_id) is None
    assert db.get(AuditLog, second_old_event_id) is not None

    assert expire_audit_logs(db, retention_days=30, now=now, limit=10) == 1
    db.commit()
    assert db.get(AuditLog, second_old_event_id) is None
    assert db.get(AuditLog, retained_event_id) is not None


def test_retention_worker_applies_configured_audit_retention_when_requested() -> None:
    db = session()
    now = datetime.now(UTC)
    expired_event = AuditLog(event_type="auth.login", created_at=now - timedelta(days=8))
    db.add(expired_event)
    db.flush()
    db.add(AuditDelivery(audit_log_id=expired_event.id, status="delivered", delivered_at=now))
    db.commit()
    expired_event_id = expired_event.id

    assert run_once(
        session_factory=SessionFactory(db),
        storage=WorkingStorage(),
        audit_retention_days=7,
    ) == 0
    assert db.get(AuditLog, expired_event_id) is None


def test_retention_worker_delivers_audit_outbox_records_before_expiration() -> None:
    db = session()
    event = record_audit_event(
        db,
        event_type="user_data.export",
        user_id=None,
        outcome="success",
    )
    db.commit()
    event_id = event.id
    sink = RecordingAuditSink()

    assert run_once(
        session_factory=SessionFactory(db),
        storage=WorkingStorage(),
        audit_delivery_sink=sink,
    ) == 0
    assert sink.delivered_event_ids == [event_id]
    delivery = db.query(AuditDelivery).filter_by(audit_log_id=event_id).one()
    assert delivery.status == "delivered"


def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class WorkingStorage:
    def delete(self, _key: str) -> None:
        return None


class FailingStorage:
    def delete(self, _key: str) -> None:
        raise RuntimeError("unavailable")


class SelectiveFailingStorage:
    def __init__(self, *, failed_key: str) -> None:
        self.failed_key = failed_key
        self.attempted_keys: list[str] = []

    def delete(self, key: str) -> None:
        self.attempted_keys.append(key)
        if key == self.failed_key:
            raise RuntimeError("unavailable")


class SessionFactory:
    def __init__(self, db) -> None:
        self.db = db
        self.closed = False
        original_close = db.close

        def close() -> None:
            self.closed = True
            original_close()

        db.close = close

    def __call__(self):
        return self.db


class RecordingAuditSink:
    def __init__(self) -> None:
        self.delivered_event_ids: list[str] = []

    def deliver(self, envelope) -> None:
        self.delivered_event_ids.append(envelope.audit_log_id)
