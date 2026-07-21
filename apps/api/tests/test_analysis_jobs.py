import asyncio
import base64
from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from tests.http_client import ApiTestClient as TestClient
from PIL import Image

from app.core.auth import CurrentUser, ensure_current_user
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.analysis import AnalysisJob
from app.models.analysis import AnalysisJobImage
from app.models.meal import MealImage
from app.models.user import AuditLog, User, UserPreference
from app.schemas.analysis import MealAnalysisResult, MealAnalysisStatus
from app.schemas.common import ConfidenceBreakdown, ConfidenceTier, NutrientsPer100g
from app.services.analysis_jobs import (
    CANCELLED,
    EXPIRED,
    NEEDS_REVIEW,
    PROCESSING,
    QUEUED,
    cancel_analysis_job,
    claim_next_analysis_job,
    complete_analysis_job,
    create_queued_analysis_job,
    expire_analysis_jobs,
    get_owned_analysis_job_or_none,
)
from app.storage import build_private_image_storage
from app.workers import meal_analysis as meal_analysis_worker
import app.models as _models  # noqa: F401


def test_analysis_job_claims_queue_reclaims_expired_lease_and_never_completes_after_cancel() -> None:
    db = session()
    user = User(email="owner@example.com")
    db.add(user)
    db.flush()
    now = datetime.now(UTC)
    job = AnalysisJob(user_id=user.id, status=QUEUED, expires_at=now + timedelta(hours=1))
    db.add(job)
    db.commit()

    claimed = claim_next_analysis_job(db, now=now)
    assert claimed is not None
    assert claimed.was_reclaimed is False
    assert claimed.job.status == PROCESSING
    assert claimed.job.attempt_count == 1

    reclaimed = claim_next_analysis_job(db, now=claimed.job.lease_expires_at + timedelta(seconds=1))
    assert reclaimed is not None
    assert reclaimed.was_reclaimed is True
    assert reclaimed.job.attempt_count == 2

    assert cancel_analysis_job(job, now=now) is True
    assert complete_analysis_job(job, result={"status": "needs_review"}, now=now) is False
    assert job.status == CANCELLED
    assert job.result_json is None


def test_analysis_job_expiry_and_owner_lookup_are_non_enumerating() -> None:
    db = session()
    owner, other = User(email="owner@example.com"), User(email="other@example.com")
    db.add_all((owner, other))
    db.flush()
    now = datetime.now(UTC)
    expired = AnalysisJob(user_id=owner.id, status=QUEUED, expires_at=now - timedelta(seconds=1))
    active = AnalysisJob(user_id=owner.id, status=QUEUED, expires_at=now + timedelta(hours=1))
    db.add_all((expired, active))
    db.commit()

    assert get_owned_analysis_job_or_none(db, user_id=other.id, job_id=expired.id) is None
    assert expire_analysis_jobs(db, now=now) == 1
    assert expired.status == EXPIRED
    assert active.status == QUEUED


def test_completed_analysis_job_is_review_only_not_a_meal() -> None:
    db = session()
    user = User(email="review@example.com")
    db.add(user)
    db.flush()
    job = AnalysisJob(user_id=user.id, status=PROCESSING)
    db.add(job)
    db.flush()

    assert complete_analysis_job(job, result={"mealName": "Review this"}) is True
    assert job.status == NEEDS_REVIEW
    assert job.result_json == {"mealName": "Review this"}


def test_queued_job_keeps_only_safe_request_metadata_and_private_image_keys() -> None:
    db = session()
    user = User(email="queued@example.com")
    db.add(user)
    db.flush()
    now = datetime.now(UTC)
    job = create_queued_analysis_job(
        db,
        user_id=user.id,
        request_payload={"referencePlateDiameterMm": 260},
        storage_keys=["analysis-job/user/image-one.jpg", "analysis-job/user/image-two.jpg"],
        retention_deadline=now + timedelta(days=1),
        reference_plate_diameter_mm=260,
        now=now,
    )
    db.commit()

    assert job.status == QUEUED
    assert job.image_count == 2
    assert job.request_payload_json == {"referencePlateDiameterMm": 260}
    assert db.query(AnalysisJobImage).filter_by(analysis_job_id=job.id).count() == 2


def test_analysis_job_status_and_cancellation_are_owner_scoped_and_delete_private_inputs() -> None:
    db = session()
    owner, other = User(email="owner@example.com"), User(email="other@example.com")
    db.add_all((owner, other))
    db.flush()
    storage = MemoryStorage()
    storage_key = storage.put(owner_id=owner.id, purpose="analysis-job", content=b"private-input")
    job = create_queued_analysis_job(
        db,
        user_id=owner.id,
        request_payload={},
        storage_keys=[storage_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    db.commit()

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=owner.id, auth_scheme="test")
    app.dependency_overrides[build_private_image_storage] = lambda: storage
    client = TestClient(app)
    try:
        status_response = client.get(f"/api/v1/meal-analysis/{job.id}")
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "queued"
        assert status_response.json()["imageCount"] == 1
        assert "storageKey" not in status_response.json()

        app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=other.id, auth_scheme="test")
        hidden = client.get(f"/api/v1/meal-analysis/{job.id}")
        assert hidden.status_code == 404
        denied_cancellation = client.delete(f"/api/v1/meal-analysis/{job.id}")
        assert denied_cancellation.status_code == 404
        assert db.get(AnalysisJob, job.id).status == QUEUED

        denial_events = db.scalars(
            select(AuditLog).where(AuditLog.event_type == "authorization.owner_access_denied")
        ).all()
        assert len(denial_events) == 2
        assert all(event.outcome == "not_found_or_not_owned" for event in denial_events)
        assert all(
            job.id
            not in " ".join(
                str(value)
                for value in (event.event_type, event.outcome, event.request_id, event.client_fingerprint)
            )
            for event in denial_events
        )

        app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=owner.id, auth_scheme="test")
        cancelled = client.delete(f"/api/v1/meal-analysis/{job.id}")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        assert db.get(AnalysisJob, job.id).status == CANCELLED
        input_image = db.query(AnalysisJobImage).filter_by(analysis_job_id=job.id).one()
        assert input_image.deleted_at is not None
        assert storage_key not in storage.objects
    finally:
        app.dependency_overrides.clear()
        db.close()


def test_discarding_completed_review_deletes_private_input_without_changing_review_result() -> None:
    db = session()
    owner = User(email="discard-review@example.com")
    db.add(owner)
    db.flush()
    storage = MemoryStorage()
    storage_key = storage.put(owner_id=owner.id, purpose="analysis-job", content=b"review-input")
    job = create_queued_analysis_job(
        db,
        user_id=owner.id,
        request_payload={},
        storage_keys=[storage_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    complete_analysis_job(job, result=completed_result().model_dump(mode="json", by_alias=True))
    db.commit()

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=owner.id, auth_scheme="test")
    app.dependency_overrides[build_private_image_storage] = lambda: storage
    client = TestClient(app)
    try:
        response = client.delete(f"/api/v1/meal-analysis/{job.id}")
        assert response.status_code == 200
        assert response.json()["status"] == NEEDS_REVIEW
        assert response.json()["result"]["mealName"] == "Review meal"
        image = db.query(AnalysisJobImage).filter_by(analysis_job_id=job.id).one()
        assert image.deleted_at is not None
        assert storage_key not in storage.objects
        audit = db.scalar(
            select(AuditLog).where(AuditLog.event_type == "meal_analysis.review_inputs_discarded")
        )
        assert audit is not None
        assert audit.outcome == "deleted"
    finally:
        app.dependency_overrides.clear()
        db.close()


def test_durable_job_endpoint_replays_without_storing_raw_base64() -> None:
    db = session()
    user = User(email="queue-api@example.com")
    db.add(user)
    db.commit()
    storage = MemoryStorage()

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=user.id, auth_scheme="test")
    app.dependency_overrides[build_private_image_storage] = lambda: storage
    client = TestClient(app)
    payload = {"imageBase64": jpeg_base64(), "referencePlateDiameterMm": 260}
    try:
        created = client.post("/api/v1/meal-analysis/jobs", json=payload, headers={"Idempotency-Key": "analysis-job-1"})
        assert created.status_code == 202
        assert created.json()["status"] == "queued"
        assert created.json()["imageCount"] == 1
        job = db.get(AnalysisJob, created.json()["id"])
        assert job is not None
        assert job.request_payload_json == {"referencePlateDiameterMm": 260.0}
        assert jpeg_base64() not in str(job.request_payload_json)
        assert len(storage.objects) == 1

        replayed = client.post("/api/v1/meal-analysis/jobs", json=payload, headers={"Idempotency-Key": "analysis-job-1"})
        assert replayed.status_code == 202
        assert replayed.json()["id"] == job.id
        assert len(storage.objects) == 1
    finally:
        app.dependency_overrides.clear()
        db.close()


def test_durable_worker_persists_review_result_and_keeps_private_input_through_review_window(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    user = User(email="worker-job@example.com")
    db.add(user)
    db.flush()
    storage = MemoryStorage()
    storage_key = storage.put(owner_id=user.id, purpose="analysis-job", content=b"normalized-image")
    job = create_queued_analysis_job(
        db,
        user_id=user.id,
        request_payload={"referencePlateDiameterMm": None},
        storage_keys=[storage_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    db.commit()
    job_id = job.id
    db.close()

    observed_inputs: list[list[str]] = []

    async def fake_analyze(images: list[str], _registry, *, reference_plate_diameter_mm=None):
        observed_inputs.append(images)
        assert reference_plate_diameter_mm is None
        return completed_result()

    monkeypatch.setattr(meal_analysis_worker, "analyze_meal_photo", fake_analyze)

    assert asyncio.run(meal_analysis_worker.run_once(session_factory=factory, storage=storage, registry=object())) is True
    check = factory()
    try:
        completed = check.get(AnalysisJob, job_id)
        assert completed is not None
        assert completed.status == NEEDS_REVIEW
        assert completed.result_json["status"] == "needs_review"
        image = check.query(AnalysisJobImage).filter_by(analysis_job_id=job_id).one()
        assert image.deleted_at is None
        assert storage.objects[storage_key] == b"normalized-image"
        assert observed_inputs == [[base64.b64encode(b"normalized-image").decode("ascii")]]
    finally:
        check.close()


def test_confirmed_meal_copies_explicitly_retained_scan_images_and_keeps_owner_access_private() -> None:
    db = session()
    owner, other = User(email="photo-owner@example.com"), User(email="photo-other@example.com")
    db.add_all((owner, other))
    db.flush()
    db.add(UserPreference(user_id=owner.id, image_retention_days=7))
    storage = MemoryStorage()
    temporary_key = storage.put(owner_id=owner.id, purpose="analysis-job", content=b"normalized-image")
    job = create_queued_analysis_job(
        db,
        user_id=owner.id,
        request_payload={},
        storage_keys=[temporary_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    complete_analysis_job(job, result={"status": "needs_review"})
    db.commit()

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=owner.id, auth_scheme="test")
    app.dependency_overrides[build_private_image_storage] = lambda: storage
    client = TestClient(app)
    try:
        created = client.post(
            "/api/v1/meals",
            json=meal_payload(analysis_job_id=job.id, retain_analysis_images=True),
            headers={"Idempotency-Key": "retained-scan-meal"},
        )
        assert created.status_code == 201
        body = created.json()
        assert len(body["images"]) == 1
        assert body["images"][0]["retentionDeadline"] is not None
        assert temporary_key not in storage.objects
        retained = db.get(MealImage, body["images"][0]["id"])
        assert retained is not None
        assert retained.storage_key in storage.objects
        assert db.query(AnalysisJobImage).filter_by(analysis_job_id=job.id).one().deleted_at is not None

        access = client.get(f"/api/v1/meals/{body['id']}/images/{retained.id}/access")
        assert access.status_code == 200
        assert access.json()["url"].startswith("https://private.example/")
        assert access.json()["expiresInSeconds"] == 300

        app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=other.id, auth_scheme="test")
        hidden = client.get(f"/api/v1/meals/{body['id']}/images/{retained.id}/access")
        assert hidden.status_code == 404

        app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(id=owner.id, auth_scheme="test")
        deleted = client.delete(f"/api/v1/meals/{body['id']}/images/{retained.id}")
        assert deleted.status_code == 204
        assert retained.deleted_at is not None
        assert retained.storage_key not in storage.objects
    finally:
        app.dependency_overrides.clear()
        db.close()


def test_durable_worker_refunds_and_cleans_up_after_analysis_failure(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    db = factory()
    user = User(email="worker-failure@example.com")
    db.add(user)
    db.flush()
    storage = MemoryStorage()
    storage_key = storage.put(owner_id=user.id, purpose="analysis-job", content=b"normalized-image")
    job = create_queued_analysis_job(
        db,
        user_id=user.id,
        request_payload={},
        storage_keys=[storage_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    db.commit()
    job_id = job.id
    db.close()

    async def failing_analyze(*_args, **_kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(meal_analysis_worker, "analyze_meal_photo", failing_analyze)

    assert asyncio.run(meal_analysis_worker.run_once(session_factory=factory, storage=storage, registry=object())) is True
    check = factory()
    try:
        failed = check.get(AnalysisJob, job_id)
        assert failed is not None
        assert failed.status == "failed"
        assert failed.error_code == "analysis_failed"
        assert check.query(AnalysisJobImage).filter_by(analysis_job_id=job_id).one().deleted_at is not None
        assert storage.objects == {}
    finally:
        check.close()


def test_worker_does_not_read_private_input_after_a_job_is_cancelled() -> None:
    db = session()
    user = User(email="worker-cancelled@example.com")
    db.add(user)
    db.flush()
    storage = MemoryStorage()
    storage_key = storage.put(owner_id=user.id, purpose="analysis-job", content=b"normalized-image")
    job = create_queued_analysis_job(
        db,
        user_id=user.id,
        request_payload={},
        storage_keys=[storage_key],
        retention_deadline=datetime.now(UTC) + timedelta(hours=1),
        reference_plate_diameter_mm=None,
    )
    cancel_analysis_job(job)
    db.commit()

    with pytest.raises(meal_analysis_worker.AnalysisJobNoLongerActiveError):
        meal_analysis_worker.read_job_input(
            session_factory=lambda: db,
            storage=storage,
            job_id=job.id,
        )

    assert storage.objects == {storage_key: b"normalized-image"}


def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, *, owner_id: str, purpose: str, content: bytes, suffix: str = ".jpg") -> str:
        key = f"{purpose}/{owner_id}/{len(self.objects)}{suffix}"
        self.objects[key] = content
        return key

    def read(self, key: str) -> bytes:
        return self.objects[key]

    def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def signed_read_url(self, key: str, *, expires_in_seconds: int) -> str:
        if key not in self.objects:
            raise FileNotFoundError(key)
        return f"https://private.example/{key}?expires={expires_in_seconds}"


def meal_payload(*, analysis_job_id: str | None = None, retain_analysis_images: bool = False) -> dict[str, object]:
    return {
        "name": "Camera meal",
        "items": [
            {
                "foodId": "usda:173944",
                "displayName": "Bananas, raw",
                "consumedGrams": 118,
                "calories": 105,
                "proteinGrams": 1.3,
                "carbohydrateGrams": 27,
                "fatGrams": 0.3,
                "sourceProvider": "usda",
                "sourceExternalId": "173944",
                "nutrientSnapshotJson": {},
                "confidence": {
                    "identity": "high",
                    "portion": "high",
                    "nutritionRecord": "high",
                    "explanation": "Confirmed before logging.",
                },
                "userConfirmed": True,
            }
        ],
        **({"analysisJobId": analysis_job_id} if analysis_job_id else {}),
        "retainAnalysisImages": retain_analysis_images,
    }


def completed_result() -> MealAnalysisResult:
    confidence = ConfidenceBreakdown(
        identity=ConfidenceTier.low,
        portion=ConfidenceTier.low,
        nutrition_record=ConfidenceTier.low,
        explanation="Review required.",
    )
    return MealAnalysisResult(
        status=MealAnalysisStatus.needs_review,
        meal_name="Review meal",
        summary="Review this meal before logging.",
        total_nutrients=NutrientsPer100g(
            calories_kcal=0,
            protein_grams=0,
            carbohydrate_grams=0,
            fat_grams=0,
        ),
        items=[],
        confidence=confidence,
    )


def jpeg_base64() -> str:
    image = Image.new("RGB", (1, 1), color="white")
    output = BytesIO()
    image.save(output, format="JPEG")
    image.close()
    return base64.b64encode(output.getvalue()).decode("ascii")
