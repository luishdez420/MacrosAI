import base64
import json
from collections.abc import Generator
from io import BytesIO

import pytest
from fastapi import HTTPException
from tests.http_client import ApiTestClient as TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.analysis.nutrition_label_analyzer import (
    RawNutritionLabelExtraction,
    analyze_nutrition_label,
    normalize_label_extraction,
)
from app.analysis import nutrition_label_analyzer
from app.analysis import meal_analyzer
from app.core.config import settings
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

    calls = 0

    async def fake_analyze(image_base64: str, barcode: str | None) -> NutritionLabelAnalysis:
        nonlocal calls
        calls += 1
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
        client = TestClient(app)
        response = client.post(
            "/api/v1/foods/label-analysis",
            json={
                "imageBase64": "aGVsbG8gd29ybGQ=",
                "barcode": "012345678905",
            },
            headers={"Idempotency-Key": "label-review-action-1"},
        )
        replayed = client.post(
            "/api/v1/foods/label-analysis",
            json={
                "imageBase64": "aGVsbG8gd29ybGQ=",
                "barcode": "012345678905",
            },
            headers={"Idempotency-Key": "label-review-action-1"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert replayed.status_code == 200
    assert replayed.json() == response.json()
    assert calls == 1
    assert response.json()["nutrientsPer100g"]["caloriesKcal"] == 400
    assert response.json()["requiresConfirmation"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("image_base64", ["aGVsbG8gd29ybGQ=", "not-valid-base64!"])
async def test_label_analysis_rejects_invalid_images_before_creating_a_vision_client(
    monkeypatch: pytest.MonkeyPatch,
    image_base64: str,
) -> None:
    class UnexpectedVisionClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise AssertionError("Invalid image data must not reach the vision client.")

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(nutrition_label_analyzer.httpx, "AsyncClient", UnexpectedVisionClient)

    with pytest.raises(HTTPException, match="image") as error:
        await analyze_nutrition_label(image_base64)

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_label_analysis_rejects_animated_images_before_creating_a_vision_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedVisionClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise AssertionError("Animated image data must not reach the vision client.")

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(nutrition_label_analyzer.httpx, "AsyncClient", UnexpectedVisionClient)

    with pytest.raises(HTTPException, match="could not be decoded safely") as error:
        await analyze_nutrition_label(animated_gif_base64())

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_label_analysis_rejects_truncated_and_pixel_limited_images_before_creating_a_vision_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedVisionClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise AssertionError("Unsafe image data must not reach the vision client.")

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(nutrition_label_analyzer.httpx, "AsyncClient", UnexpectedVisionClient)

    with pytest.raises(HTTPException, match="could not be decoded safely") as truncated:
        await analyze_nutrition_label("/9j/4A==")
    assert truncated.value.status_code == 400

    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 3)
    with pytest.raises(HTTPException, match="could not be decoded safely") as decompression_bomb:
        await analyze_nutrition_label(tiny_jpeg_base64())
    assert decompression_bomb.value.status_code == 400


@pytest.mark.asyncio
async def test_label_analysis_rejects_an_oversized_decoded_image_before_creating_a_vision_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedVisionClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise AssertionError("Oversized image data must not reach the vision client.")

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(meal_analyzer, "MAX_ANALYSIS_IMAGE_BYTES", 1)
    monkeypatch.setattr(nutrition_label_analyzer.httpx, "AsyncClient", UnexpectedVisionClient)

    with pytest.raises(HTTPException, match="too large") as error:
        await analyze_nutrition_label(tiny_jpeg_base64())

    assert error.value.status_code == 413


@pytest.mark.asyncio
async def test_label_analysis_sends_a_metadata_free_normalized_image_to_the_vision_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent_payload: dict[str, object] = {}

    class FakeResponse:
        is_success = True

        def json(self) -> dict[str, str]:
            return {
                "output_text": json.dumps(
                    {
                        "display_name": "Oat bar",
                        "brand_owner": "Test Foods",
                        "serving_size_text": "1 bar (40 g)",
                        "serving_size_grams": 40,
                        "nutrition_basis": "per_serving",
                        "calories_kcal": 160,
                        "protein_grams": 4,
                        "carbohydrate_grams": 24,
                        "fat_grams": 6,
                        "fiber_grams": None,
                        "sugar_grams": None,
                        "sodium_milligrams": None,
                        "confidence": "high",
                        "warnings": [],
                    }
                )
            }

    class CapturingVisionClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "CapturingVisionClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, *_args: object, **kwargs: object) -> FakeResponse:
            sent_payload.update(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(nutrition_label_analyzer.httpx, "AsyncClient", CapturingVisionClient)

    await analyze_nutrition_label(tiny_jpeg_base64(with_exif=True))

    user_content = sent_payload["input"][1]["content"]
    encoded_image = user_content[1]["image_url"].split(",", 1)[1]
    with Image.open(BytesIO(base64.b64decode(encoded_image))) as image:
        assert image.format == "JPEG"
        assert image.getexif().get(0x010F) is None
        assert image.info.get("exif") is None


def animated_gif_base64() -> str:
    first_frame = Image.new("RGB", (2, 2), color=(24, 48, 72))
    second_frame = Image.new("RGB", (2, 2), color=(72, 48, 24))
    output = BytesIO()
    try:
        first_frame.save(output, format="GIF", save_all=True, append_images=[second_frame], loop=0)
    finally:
        first_frame.close()
        second_frame.close()
    return base64.b64encode(output.getvalue()).decode("ascii")


def tiny_jpeg_base64(*, with_exif: bool = False) -> str:
    image = Image.new("RGB", (2, 2), color=(24, 48, 72))
    output = BytesIO()
    exif = Image.Exif()
    if with_exif:
        exif[0x010F] = "Private camera name"
    try:
        image.save(output, format="JPEG", exif=exif)
        return base64.b64encode(output.getvalue()).decode("ascii")
    finally:
        image.close()
