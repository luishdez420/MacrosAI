from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.analysis.nutrition_label_analyzer import (
    RawNutritionLabelExtraction,
    normalize_label_extraction,
)
from app.api.v1 import food_routes
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import (
    LabelNutrients,
    LabelNutritionBasis,
    NutritionLabelAnalysis,
)
import app.models as _models  # noqa: F401


def test_label_extraction_normalizes_per_serving_values_to_per_100g() -> None:
    result = normalize_label_extraction(
        RawNutritionLabelExtraction(
            display_name="Oat bar",
            brand_owner="Test Foods",
            serving_size_text="1 bar (40 g)",
            serving_size_grams=40,
            nutrition_basis=LabelNutritionBasis.per_serving,
            calories_kcal=160,
            protein_grams=4,
            carbohydrate_grams=24,
            fat_grams=6,
            fiber_grams=3,
            sugar_grams=8,
            sodium_milligrams=120,
            confidence=ConfidenceTier.high,
            warnings=[],
        ),
        barcode="0 12345-67890 5",
    )

    assert result.barcode == "012345678905"
    assert result.nutrients_per_100g == NutrientsPer100g(
        calories_kcal=400,
        protein_grams=10,
        carbohydrate_grams=60,
        fat_grams=15,
        fiber_grams=7.5,
        sugar_grams=20,
        sodium_milligrams=300,
    )
    assert result.requires_confirmation is True
    assert result.quality_flags == []


def test_label_extraction_does_not_convert_serving_values_without_grams() -> None:
    result = normalize_label_extraction(
        RawNutritionLabelExtraction(
            display_name="Soup",
            brand_owner=None,
            serving_size_text="1 cup",
            serving_size_grams=None,
            nutrition_basis=LabelNutritionBasis.per_serving,
            calories_kcal=90,
            protein_grams=3,
            carbohydrate_grams=14,
            fat_grams=2,
            fiber_grams=None,
            sugar_grams=None,
            sodium_milligrams=640,
            confidence=ConfidenceTier.medium,
            warnings=[],
        )
    )

    assert result.nutrients_per_100g is None
    assert "missing_serving_grams" in result.quality_flags
    assert "per_100g_unavailable" in result.quality_flags
    assert any("no verified gram weight" in warning for warning in result.warnings)


def test_label_analysis_endpoint_returns_editable_unpersisted_result(monkeypatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    async def fake_analyze(image_base64: str, barcode: str | None) -> NutritionLabelAnalysis:
        assert image_base64 == "aGVsbG8gd29ybGQ="
        assert barcode == "012345678905"
        return NutritionLabelAnalysis(
            display_name="Oat bar",
            brand_owner="Test Foods",
            barcode=barcode,
            serving_size_text="1 bar (40 g)",
            serving_size_grams=40,
            nutrition_basis=LabelNutritionBasis.per_serving,
            label_nutrients=LabelNutrients(
                calories_kcal=160,
                protein_grams=4,
                carbohydrate_grams=24,
                fat_grams=6,
            ),
            nutrients_per_100g=NutrientsPer100g(
                calories_kcal=400,
                protein_grams=10,
                carbohydrate_grams=60,
                fat_grams=15,
            ),
            confidence=ConfidenceTier.high,
            warnings=["Compare every value with the label."],
            requires_confirmation=True,
        )

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(food_routes, "analyze_nutrition_label", fake_analyze)

    try:
        response = TestClient(app).post(
            "/api/v1/foods/label-analysis",
            json={
                "imageBase64": "aGVsbG8gd29ybGQ=",
                "barcode": "012345678905",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["nutrientsPer100g"]["caloriesKcal"] == 400
    assert response.json()["requiresConfirmation"] is True
