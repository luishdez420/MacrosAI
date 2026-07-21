from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1 import meal_analysis_routes
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.idempotency import IdempotencyRecord
from app.schemas.analysis import MealAnalysisResult, MealAnalysisStatus
from app.schemas.common import ConfidenceBreakdown, ConfidenceTier, NutrientsPer100g
import app.models as _models  # noqa: F401


def test_meal_analysis_replays_exact_requests_without_resubmitting_paid_work(monkeypatch) -> None:
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
        payload = {
            "imageBase64": "aGVsbG8gd29ybGQ=",
            "referencePlateDiameterMm": 280,
        }
        headers = {"Idempotency-Key": "analysis-camera-action-1"}

        created = client.post("/api/v1/meal-analysis", json=payload, headers=headers)
        replayed = client.post("/api/v1/meal-analysis", json=payload, headers=headers)

        assert created.status_code == 200
        assert replayed.status_code == 200
        assert replayed.json() == created.json()
        assert calls == 1

        with session_factory() as db:
            record = db.scalar(select(IdempotencyRecord))
            assert record is not None
            assert record.status == "completed"
            assert record.request_fingerprint != payload["imageBase64"]
            assert "imageBase64" not in (record.response_body_json or {})
    finally:
        app.dependency_overrides.clear()


def test_meal_analysis_rejects_mismatched_or_ambiguous_idempotency_keys(monkeypatch) -> None:
    session_factory = create_test_session_factory()
    app.dependency_overrides[get_db] = database_override(session_factory)

    async def fake_analyze(*_args, **_kwargs) -> MealAnalysisResult:
        return analysis_result()

    monkeypatch.setattr(meal_analysis_routes, "analyze_meal_photo", fake_analyze)

    try:
        client = TestClient(app)
        headers = {"Idempotency-Key": "analysis-camera-action-2"}
        initial = client.post(
            "/api/v1/meal-analysis",
            json={"imageBase64": "aGVsbG8gd29ybGQ="},
            headers=headers,
        )
        assert initial.status_code == 200

        conflicting = client.post(
            "/api/v1/meal-analysis",
            json={"imageBase64": "c2Vjb25kLWltYWdlLWRhdGE="},
            headers=headers,
        )
        assert conflicting.status_code == 409
        assert "different request" in conflicting.json()["error"]["message"]

        mismatched_sources = client.post(
            "/api/v1/meal-analysis",
            json={
                "imageBase64": "aGVsbG8gd29ybGQ=",
                "idempotencyKey": "body-key-does-not-match",
            },
            headers={"Idempotency-Key": "header-key-does-not-match"},
        )
        assert mismatched_sources.status_code == 422
        assert "must match" in mismatched_sources.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


def create_test_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
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
    confidence = ConfidenceBreakdown(
        identity=ConfidenceTier.low,
        portion=ConfidenceTier.low,
        nutrition_record=ConfidenceTier.low,
        explanation="No visible foods were identified.",
    )
    return MealAnalysisResult(
        id="analysis-replay-safe",
        status=MealAnalysisStatus.needs_review,
        meal_name="Meal scan",
        summary="No foods were detected in the photo.",
        total_nutrients=NutrientsPer100g(
            calories_kcal=0,
            protein_grams=0,
            carbohydrate_grams=0,
            fat_grams=0,
        ),
        items=[],
        confidence=confidence,
    )
