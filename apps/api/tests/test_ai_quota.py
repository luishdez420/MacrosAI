from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import meal_analysis_routes
from app.core.ai_quota import (
    AI_USAGE_EXPIRED,
    AI_OPERATION_LABEL_ANALYSIS,
    AiQuotaExceededError,
    as_utc,
    expire_stale_ai_usage_reservations,
    renew_ai_usage_record,
    reserve_ai_usage,
    settle_ai_usage,
)
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.usage import AiUsageRecord
from app.models.user import User
from app.schemas.analysis import MealAnalysisResult, MealAnalysisStatus
from app.schemas.common import ConfidenceBreakdown, ConfidenceTier, NutrientsPer100g
import app.models as _models  # noqa: F401


def test_analysis_settles_one_hashed_usage_record_and_replays_without_a_second_charge(monkeypatch) -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)
    calls = 0

    async def fake_analyze(*_args, **_kwargs) -> MealAnalysisResult:
        nonlocal calls
        calls += 1
        return analysis_result()

    monkeypatch.setattr(meal_analysis_routes, "analyze_meal_photo", fake_analyze)

    try:
        client = TestClient(app)
        headers = {"Idempotency-Key": "quota-replay-safe"}
        first = client.post("/api/v1/meal-analysis", json={"imageBase64": "aGVsbG8gd29ybGQ="}, headers=headers)
        replay = client.post("/api/v1/meal-analysis", json={"imageBase64": "aGVsbG8gd29ybGQ="}, headers=headers)

        assert first.status_code == 200
        assert replay.status_code == 200
        assert first.headers["x-ai-quota-remaining"] == "19"
        assert calls == 1
        with session_factory() as db:
            records = db.scalars(select(AiUsageRecord)).all()
            assert len(records) == 1
            assert records[0].status == "settled"
            assert records[0].idempotency_key_hash != headers["Idempotency-Key"]
            assert records[0].units == 1
    finally:
        app.dependency_overrides.clear()


def test_failed_analysis_refunds_usage_and_a_retry_reuses_the_ledger_record(monkeypatch) -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)
    calls = 0

    async def fail_once(*_args, **_kwargs) -> MealAnalysisResult:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("provider timeout")
        return analysis_result()

    monkeypatch.setattr(meal_analysis_routes, "analyze_meal_photo", fail_once)

    try:
        client = TestClient(app, raise_server_exceptions=False)
        headers = {"Idempotency-Key": "quota-refund-safe"}
        failed = client.post("/api/v1/meal-analysis", json={"imageBase64": "aGVsbG8gd29ybGQ="}, headers=headers)
        retried = client.post("/api/v1/meal-analysis", json={"imageBase64": "aGVsbG8gd29ybGQ="}, headers=headers)

        assert failed.status_code == 500
        assert retried.status_code == 200
        assert calls == 2
        with session_factory() as db:
            record = db.scalar(select(AiUsageRecord))
            assert record is not None
            assert record.status == "settled"
            assert record.refund_count == 1
            assert record.reservation_attempts == 2
    finally:
        app.dependency_overrides.clear()


def test_quota_denial_is_safe_and_releases_the_pending_idempotency_reservation(monkeypatch) -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)
    monkeypatch.setattr(settings, "ai_quota_free_meal_analysis_limit", 1)
    monkeypatch.setattr(settings, "ai_quota_free_images_limit", 1)

    async def fake_analyze(*_args, **_kwargs) -> MealAnalysisResult:
        return analysis_result()

    monkeypatch.setattr(meal_analysis_routes, "analyze_meal_photo", fake_analyze)

    try:
        client = TestClient(app)
        first = client.post(
            "/api/v1/meal-analysis",
            json={"imageBase64": "aGVsbG8gd29ybGQ="},
            headers={"Idempotency-Key": "quota-limit-first"},
        )
        denied = client.post(
            "/api/v1/meal-analysis",
            json={"imageBase64": "c2Vjb25kLWltYWdlLWRhdGE="},
            headers={"Idempotency-Key": "quota-limit-second"},
        )

        assert first.status_code == 200
        assert denied.status_code == 429
        assert denied.json()["error"]["code"] == "ai_quota_exceeded"
        assert denied.headers["x-ai-quota-remaining"] == "0"
        with session_factory() as db:
            assert db.scalar(select(AiUsageRecord).where(AiUsageRecord.status == "settled")) is not None
            # The denied action did not reserve a second usage record.
            assert len(db.scalars(select(AiUsageRecord)).all()) == 1
    finally:
        app.dependency_overrides.clear()


def test_concurrent_allowance_blocks_another_operation_before_provider_dispatch(monkeypatch) -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    monkeypatch.setattr(settings, "ai_quota_free_concurrent_limit", 1)

    with session_factory() as db:
        user = User(email="quota@example.com", auth_provider="local")
        db.add(user)
        db.commit()
        reserve_ai_usage(
            db,
            user_id=user.id,
            operation="meal-analysis.create",
            units=1,
            idempotency_key="one-active-analysis",
        )
        with pytest.raises(AiQuotaExceededError):
            reserve_ai_usage(
                db,
                user_id=user.id,
                operation=AI_OPERATION_LABEL_ANALYSIS,
                units=1,
                idempotency_key="second-active-analysis",
            )


def test_expired_durable_reservation_is_renewed_before_worker_dispatch() -> None:
    session_factory = create_test_session_factory()
    with session_factory() as db:
        user = User(email="durable-quota@example.com", auth_provider="local")
        db.add(user)
        db.flush()
        reservation = reserve_ai_usage(
            db,
            user_id=user.id,
            operation="meal-analysis.create",
            units=1,
            idempotency_key="durable-worker-job",
        )
        reservation.record.reservation_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        record_id = reservation.record.id
        db.commit()

        assert renew_ai_usage_record(db, record_id=record_id) is True
        record = db.get(AiUsageRecord, record_id)
        assert record is not None
        assert record.status == "reserved"
        assert record.reservation_attempts == 2
        assert as_utc(record.reservation_expires_at) > datetime.now(UTC)


def test_global_reconciliation_expires_only_a_bounded_oldest_first_batch() -> None:
    session_factory = create_test_session_factory()
    now = datetime.now(UTC)
    with session_factory() as db:
        user = User(email="quota-reconciliation@example.com", auth_provider="local")
        db.add(user)
        db.flush()
        expired_records = [
            AiUsageRecord(
                user_id=user.id,
                operation="meal-analysis.create",
                entitlement_tier="free",
                units=1,
                status="reserved",
                reserved_at=now - timedelta(minutes=15 + index),
                reservation_expires_at=now - timedelta(seconds=index + 1),
            )
            for index in range(2)
        ]
        active_record = AiUsageRecord(
            user_id=user.id,
            operation="meal-analysis.create",
            entitlement_tier="free",
            units=1,
            status="reserved",
            reserved_at=now,
            reservation_expires_at=now + timedelta(minutes=5),
        )
        settled_record = AiUsageRecord(
            user_id=user.id,
            operation="meal-analysis.create",
            entitlement_tier="free",
            units=1,
            status="settled",
            reserved_at=now - timedelta(minutes=5),
            reservation_expires_at=now - timedelta(minutes=5),
            settled_at=now - timedelta(minutes=5),
        )
        db.add_all([*expired_records, active_record, settled_record])
        db.commit()

        assert expire_stale_ai_usage_reservations(db, now=now, limit=1) == 1
        db.commit()
        assert db.get(AiUsageRecord, expired_records[1].id).status == AI_USAGE_EXPIRED
        assert db.get(AiUsageRecord, expired_records[0].id).status == "reserved"
        assert db.get(AiUsageRecord, active_record.id).status == "reserved"
        assert db.get(AiUsageRecord, settled_record.id).status == "settled"

        assert expire_stale_ai_usage_reservations(db, now=now, limit=10) == 1
        db.commit()
        assert db.get(AiUsageRecord, expired_records[0].id).status == AI_USAGE_EXPIRED


def test_current_user_ai_usage_exposes_only_safe_allowance_fields() -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)

    try:
        with session_factory() as db:
            user = User(email="allowance@example.com", auth_provider="local")
            other_user = User(email="other-allowance@example.com", auth_provider="local")
            db.add_all([user, other_user])
            db.flush()
            user_id = user.id
            other_user_id = other_user.id
            reservation = reserve_ai_usage(
                db,
                user_id=user_id,
                operation="meal-analysis.create",
                units=1,
                idempotency_key="allowance-current-user",
            )
            settle_ai_usage(db, reservation)
            other_reservation = reserve_ai_usage(
                db,
                user_id=other_user_id,
                operation="meal-analysis.create",
                units=4,
                idempotency_key="allowance-other-user",
            )
            settle_ai_usage(db, other_reservation)
            db.commit()

        client = TestClient(app)
        response = client.get(
            "/api/v1/account/ai-usage",
            headers={"Authorization": f"Bearer local:{user_id}"},
        )

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {"windowDays", "mealAnalysis", "nutritionLabelAnalysis"}
        assert body["mealAnalysis"] == {
            "remainingOperations": 19,
            "operationLimit": 20,
            "remainingImages": 39,
            "imageLimit": 40,
            "remainingConcurrent": 1,
            "concurrencyLimit": 1,
            "available": True,
            "nextAvailabilityAt": None,
        }
        assert body["nutritionLabelAnalysis"]["remainingOperations"] == 10
        assert "tier" not in body
        assert "usage" not in body
    finally:
        app.dependency_overrides.clear()


def test_current_user_ai_usage_explains_busy_and_exhausted_capacity(monkeypatch) -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)
    monkeypatch.setattr(settings, "ai_quota_free_label_analysis_limit", 1)

    try:
        with session_factory() as db:
            user = User(email="busy-allowance@example.com", auth_provider="local")
            db.add(user)
            db.flush()
            user_id = user.id
            meal_reservation = reserve_ai_usage(
                db,
                user_id=user_id,
                operation="meal-analysis.create",
                units=1,
                idempotency_key="allowance-busy-meal",
            )
            meal_reservation_id = meal_reservation.record.id
            db.commit()

        client = TestClient(app)
        busy_response = client.get(
            "/api/v1/account/ai-usage",
            headers={"Authorization": f"Bearer local:{user_id}"},
        )

        assert busy_response.status_code == 200
        assert busy_response.json()["mealAnalysis"]["available"] is False
        assert busy_response.json()["mealAnalysis"]["remainingConcurrent"] == 0
        assert busy_response.json()["mealAnalysis"]["nextAvailabilityAt"] is not None

        with session_factory() as db:
            persisted_meal_reservation = db.get(AiUsageRecord, meal_reservation_id)
            assert persisted_meal_reservation is not None
            persisted_meal_reservation.status = "settled"
            persisted_meal_reservation.settled_at = datetime.now(UTC)
            persisted_meal_reservation.reservation_expires_at = persisted_meal_reservation.settled_at
            db.flush()
            label_reservation = reserve_ai_usage(
                db,
                user_id=user_id,
                operation=AI_OPERATION_LABEL_ANALYSIS,
                units=1,
                idempotency_key="allowance-spent-label",
            )
            settle_ai_usage(db, label_reservation)
            db.commit()

        exhausted_response = client.get(
            "/api/v1/account/ai-usage",
            headers={"Authorization": f"Bearer local:{user_id}"},
        )
        assert exhausted_response.status_code == 200
        label_allowance = exhausted_response.json()["nutritionLabelAnalysis"]
        assert label_allowance["available"] is False
        assert label_allowance["remainingOperations"] == 0
        assert label_allowance["nextAvailabilityAt"] is not None
    finally:
        app.dependency_overrides.clear()


def create_test_session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return session_factory


def database_override(session_factory):
    def override_get_db() -> Generator[Session, None, None]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    return override_get_db


def analysis_result() -> MealAnalysisResult:
    return MealAnalysisResult(
        id="analysis-quota-safe",
        status=MealAnalysisStatus.needs_review,
        meal_name="Meal scan",
        summary="No foods were detected.",
        total_nutrients=NutrientsPer100g(calories_kcal=0, protein_grams=0, carbohydrate_grams=0, fat_grams=0),
        items=[],
        confidence=ConfidenceBreakdown(
            identity=ConfidenceTier.low,
            portion=ConfidenceTier.low,
            nutrition_record=ConfidenceTier.low,
            explanation="Review required.",
        ),
    )
