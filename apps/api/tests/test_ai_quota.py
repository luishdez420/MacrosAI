from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import meal_analysis_routes
from app.core.ai_quota import (
    AI_OPERATION_LABEL_ANALYSIS,
    AiQuotaExceededError,
    as_utc,
    renew_ai_usage_record,
    reserve_ai_usage,
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
