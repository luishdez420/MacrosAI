import base64
from io import BytesIO

import pytest
from fastapi import HTTPException
from PIL import Image

from app.analysis import meal_analyzer
from app.analysis.meal_analyzer import (
    DetectedFoodItem,
    MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS,
    MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS,
    apply_view_evidence_to_identity_confidence,
    analyze_meal_photo,
    analyze_detected_item,
    normalize_candidate_labels,
    normalize_hidden_ingredient_hints,
    normalize_visible_preparation,
    plate_reference_instruction,
    pick_best_food_record,
    resolve_candidate_foods,
    resolve_portion_range,
    resolve_serving,
    resolve_view_evidence,
    sanitize_base64_image,
    sanitize_base64_images,
)
from app.core.config import settings
from app.nutrition.provider_registry import NutritionProviderRegistry
from app.nutrition.providers.e2e_fixture import E2EFixtureNutritionProvider
from app.schemas.analysis import MealAnalysisRequest
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResponse, FoodSearchResult, ProviderName


def test_resolve_serving_corrects_impossible_medium_banana() -> None:
    item = DetectedFoodItem(
        name="banana raw",
        serving_label="1 medium banana",
        estimated_grams=450,
        identity_confidence=ConfidenceTier.high,
        portion_confidence=ConfidenceTier.high,
    )

    grams, label, note, confidence = resolve_serving(item)

    assert grams == 118
    assert label == "1 medium banana"
    assert confidence == ConfidenceTier.medium
    assert "Adjusted an unlikely portion" in note


def test_portion_range_is_constrained_for_an_implausible_whole_food_estimate() -> None:
    item = DetectedFoodItem(
        name="banana raw",
        serving_label="1 medium banana",
        estimated_grams=450,
        portion_range_grams={"minimum": 400, "maximum": 500},
        identity_confidence=ConfidenceTier.high,
        portion_confidence=ConfidenceTier.high,
    )
    serving_grams, _, _, _ = resolve_serving(item)

    portion_range = resolve_portion_range(item, serving_grams)

    assert serving_grams == 118
    assert portion_range.minimum == 70
    assert portion_range.maximum == 165


def test_scan_cues_normalize_preparation_and_hidden_ingredient_hints() -> None:
    assert normalize_visible_preparation("Grill") == "grilled"
    assert normalize_visible_preparation("microwaved") == "not_sure"
    assert normalize_hidden_ingredient_hints(["cooking oil", "Cooking oil", " sauce "]) == [
        "cooking oil",
        "sauce",
    ]


def test_pick_best_food_record_prefers_raw_banana_over_chips() -> None:
    raw_banana = make_food(
        display_name="Bananas, raw",
        data_type="Foundation",
        calories=89,
        carbs=22.8,
    )
    banana_chips = make_food(
        display_name="Banana chips",
        data_type="SR Legacy",
        calories=519,
        carbs=58.4,
    )

    result = pick_best_food_record([banana_chips, raw_banana], "banana raw")

    assert result == raw_banana


def test_candidate_labels_are_normalized_and_deduplicated() -> None:
    item = DetectedFoodItem(
        name="grilled chicken breast",
        candidate_labels=["Grilled chicken breast", "chicken thigh grilled", "roasted chicken"],
        serving_label="1 portion",
        estimated_grams=140,
        identity_confidence=ConfidenceTier.medium,
        portion_confidence=ConfidenceTier.low,
    )

    labels = normalize_candidate_labels(item, "Chicken breast, grilled")

    assert labels == [
        "grilled chicken breast",
        "chicken thigh grilled",
        "roasted chicken",
        "Chicken breast, grilled",
    ]


def test_corroborated_view_evidence_reorders_only_alternate_review_labels() -> None:
    item = DetectedFoodItem(
        name="grilled chicken breast",
        candidate_labels=["roasted chicken", "grilled chicken thigh"],
        candidate_view_evidence=[
            {"label": "roasted chicken", "observed_in_view_indexes": [2]},
            {"label": "grilled chicken thigh", "observed_in_view_indexes": [1, 2]},
        ],
        visible_view_indexes=[1, 2, 9],
        serving_label="1 portion",
        estimated_grams=140,
        identity_confidence=ConfidenceTier.medium,
        portion_confidence=ConfidenceTier.low,
    )

    evidence = resolve_view_evidence(item, image_count=3)
    labels = normalize_candidate_labels(item, image_count=3)

    assert evidence.status == "corroborated"
    assert evidence.observed_in_view_indexes == [1, 2]
    assert labels == ["grilled chicken breast", "grilled chicken thigh", "roasted chicken"]
    assert apply_view_evidence_to_identity_confidence(ConfidenceTier.medium, evidence) == ConfidenceTier.medium


def test_conflicting_views_reduce_identity_confidence_without_creating_a_verified_match() -> None:
    item = DetectedFoodItem(
        name="chicken breast",
        candidate_labels=["chicken thigh"],
        visible_view_indexes=[1, 2],
        view_disagreement=True,
        serving_label="1 portion",
        estimated_grams=120,
        identity_confidence=ConfidenceTier.high,
        portion_confidence=ConfidenceTier.medium,
    )

    evidence = resolve_view_evidence(item, image_count=2)

    assert evidence.status == "conflicting"
    assert apply_view_evidence_to_identity_confidence(ConfidenceTier.high, evidence) == ConfidenceTier.medium
    assert "competing identity cues" in evidence.explanation


@pytest.mark.asyncio
async def test_candidate_records_resolve_only_alternates_and_skip_the_selected_match() -> None:
    primary = make_food(
        display_name="Chicken breast, grilled",
        data_type="Foundation",
        calories=165,
        carbs=0,
    )
    roasted = make_food(
        display_name="Chicken breast, roasted",
        data_type="Foundation",
        calories=185,
        carbs=0,
    )
    thigh = make_food(
        display_name="Chicken thigh, roasted",
        data_type="Survey (FNDDS)",
        calories=208,
        carbs=0,
    )

    class CandidateRegistry:
        async def search_foods(self, query: str, locale: str) -> FoodSearchResponse:
            assert locale == "en-US"
            if query == "roasted chicken breast":
                return FoodSearchResponse(items=[roasted])
            if query == "roasted chicken thigh":
                return FoodSearchResponse(items=[thigh, primary])
            raise AssertionError(f"Unexpected candidate query: {query}")

    result = await resolve_candidate_foods(
        ["grilled chicken breast", "roasted chicken breast", "roasted chicken thigh"],
        CandidateRegistry(),  # type: ignore[arg-type]
        selected_food_id=primary.id,
    )

    assert [food.id for food in result] == [roasted.id, thigh.id]


@pytest.mark.asyncio
async def test_high_confidence_match_does_not_fetch_alternate_provider_records() -> None:
    """Candidate records are an uncertainty aid, not extra work on a confident match."""

    primary = make_food(
        display_name="Chicken breast, grilled",
        data_type="Foundation",
        calories=165,
        carbs=0,
    )

    class HighConfidenceRegistry:
        queries: list[str] = []

        async def search_foods(self, query: str, locale: str) -> FoodSearchResponse:
            self.queries.append(query)
            return FoodSearchResponse(items=[primary])

    registry = HighConfidenceRegistry()
    result = await analyze_detected_item(
        DetectedFoodItem(
            name="grilled chicken breast",
            candidate_labels=["roasted chicken breast"],
            serving_label="1 portion",
            estimated_grams=120,
            identity_confidence=ConfidenceTier.high,
            portion_confidence=ConfidenceTier.medium,
        ),
        registry,  # type: ignore[arg-type]
    )

    assert result.candidate_foods == []
    assert registry.queries == ["grilled chicken breast"]


def test_sanitize_base64_image_accepts_data_url() -> None:
    source = tiny_jpeg_base64()

    sanitized = sanitize_base64_image(f"data:image/jpeg;base64,{source}")

    with Image.open(BytesIO(base64.b64decode(sanitized))) as image:
        assert image.format == "JPEG"
        assert image.size == (2, 2)


def test_sanitize_base64_image_strips_exif_metadata_before_provider_use() -> None:
    source = tiny_jpeg_base64(with_exif=True)

    sanitized = sanitize_base64_image(source)

    assert sanitized != source
    with Image.open(BytesIO(base64.b64decode(sanitized))) as image:
        assert image.getexif().get(0x010F) is None
        assert image.info.get("exif") is None


def test_sanitize_base64_image_rejects_non_image_data() -> None:
    with pytest.raises(HTTPException, match="JPEG, PNG, WebP, or GIF"):
        sanitize_base64_image("aGVsbG8gd29ybGQ=")


def test_sanitize_base64_image_rejects_oversized_encoded_payload_before_decoding() -> None:
    with pytest.raises(HTTPException, match="too large") as error:
        sanitize_base64_image("A" * (MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS + 1))

    assert error.value.status_code == 413


def test_sanitize_base64_image_rejects_malformed_data_with_a_supported_signature() -> None:
    malformed_png = base64.b64encode(b"\x89PNG\r\n\x1a\nnot-a-real-png").decode("ascii")

    with pytest.raises(HTTPException, match="could not be decoded safely"):
        sanitize_base64_image(malformed_png)


def test_sanitize_base64_image_rejects_animated_images() -> None:
    with pytest.raises(HTTPException, match="could not be decoded safely"):
        sanitize_base64_image(animated_gif_base64())


def test_sanitize_base64_images_accepts_three_valid_meal_views() -> None:
    images = [tiny_jpeg_base64(), tiny_jpeg_base64(), tiny_jpeg_base64()]

    assert len(sanitize_base64_images(images)) == 3


def test_sanitize_base64_images_rejects_more_than_three_views() -> None:
    with pytest.raises(HTTPException, match="no more than three"):
        sanitize_base64_images(["/9j/4A=="] * 4)


def test_sanitize_base64_images_rejects_the_combined_encoded_budget_before_decoding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_per_image_sanitizer(_: str) -> str:
        raise AssertionError("Combined image size must be rejected before decoding an individual image.")

    encoded_length = MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS // 3 + 1
    monkeypatch.setattr("app.analysis.meal_analyzer.sanitize_base64_image", unexpected_per_image_sanitizer)

    with pytest.raises(HTTPException, match="combined meal photos are too large") as error:
        sanitize_base64_images(["A" * encoded_length] * 3)

    assert error.value.status_code == 413


def test_sanitize_base64_image_rejects_truncated_image_data() -> None:
    with pytest.raises(HTTPException, match="could not be decoded safely"):
        sanitize_base64_image("/9j/4A==")


def test_sanitize_base64_image_rejects_decompression_bomb_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 3)

    with pytest.raises(HTTPException, match="could not be decoded safely") as error:
        sanitize_base64_image(tiny_jpeg_base64())

    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_vision_provider_failure_does_not_expose_its_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_marker = "provider-body-must-not-reach-the-client"

    class FailedResponse:
        is_success = False
        status_code = 401
        text = provider_marker

    class FailedClient:
        async def __aenter__(self) -> "FailedClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, *args: object, **kwargs: object) -> FailedResponse:
            return FailedResponse()

    monkeypatch.setattr(settings, "e2e_fixture_mode", False)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(meal_analyzer.httpx, "AsyncClient", lambda **_: FailedClient())

    with pytest.raises(HTTPException) as error:
        await meal_analyzer.identify_foods_with_openai([tiny_jpeg_base64()])

    assert error.value.status_code == 502
    assert "HTTP 401" in str(error.value.detail)
    assert provider_marker not in str(error.value.detail)


@pytest.mark.asyncio
async def test_malformed_vision_output_does_not_expose_provider_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_marker = "malformed-provider-output-must-not-reach-the-client"

    class InvalidResponse:
        is_success = True

        def json(self) -> dict[str, str]:
            return {"output_text": provider_marker}

    class InvalidClient:
        async def __aenter__(self) -> "InvalidClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, *args: object, **kwargs: object) -> InvalidResponse:
            return InvalidResponse()

    monkeypatch.setattr(settings, "e2e_fixture_mode", False)
    monkeypatch.setattr(settings, "openai_api_key", "test-key")
    monkeypatch.setattr(meal_analyzer.httpx, "AsyncClient", lambda **_: InvalidClient())

    with pytest.raises(HTTPException) as error:
        await meal_analyzer.identify_foods_with_openai([tiny_jpeg_base64()])

    assert error.value.status_code == 502
    assert provider_marker not in str(error.value.detail)
    assert "unreadable result" in str(error.value.detail)


def test_sanitize_base64_image_checks_pixel_limit_before_loading_image_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class OversizedImage:
        width = 6_001
        height = 6_000
        is_animated = False
        n_frames = 1

        def __enter__(self) -> "OversizedImage":
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def load(self) -> None:
            raise AssertionError("Pixel validation must run before image bytes are loaded.")

    monkeypatch.setattr(Image, "open", lambda _: OversizedImage())

    with pytest.raises(HTTPException, match="could not be decoded safely"):
        sanitize_base64_image(tiny_jpeg_base64())


def test_meal_analysis_request_accepts_legacy_or_multi_view_input() -> None:
    image = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w=="
    legacy = MealAnalysisRequest.model_validate({"imageBase64": image})
    multi_view = MealAnalysisRequest.model_validate(
        {"imagesBase64": [image, image]}
    )

    assert legacy.analysis_images == [image]
    assert multi_view.analysis_images == [image, image]


def test_meal_analysis_request_accepts_a_bounded_optional_plate_reference() -> None:
    request = MealAnalysisRequest.model_validate(
        {
            "imagesBase64": ["/9j/4AAQSkZJRgABAQAAAQABAAD/2w=="],
            "referencePlateDiameterMm": 280,
        }
    )

    assert request.reference_plate_diameter_mm == 280

    with pytest.raises(ValueError, match="greater than or equal to 100"):
        MealAnalysisRequest.model_validate(
            {"imageBase64": "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==", "referencePlateDiameterMm": 80}
        )


def test_plate_reference_prompt_keeps_gram_confirmation_required() -> None:
    assert plate_reference_instruction(None) == "No known-size plate reference was provided."

    instruction = plate_reference_instruction(280)

    assert "280 mm" in instruction
    assert "optional visual scale cue" in instruction
    assert "cannot establish exact grams" in instruction
    assert "must not increase portion confidence" in instruction


@pytest.mark.asyncio
async def test_e2e_fixture_analysis_uses_validated_image_and_provider_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "e2e_fixture_mode", True)

    result = await analyze_meal_photo(
        [tiny_jpeg_base64()],
        NutritionProviderRegistry([E2EFixtureNutritionProvider()]),
    )

    assert result.status.value == "needs_review"
    assert result.items[0].display_name == "Chicken breast, grilled"
    assert result.items[0].needs_review is True


def test_meal_analysis_request_requires_an_image() -> None:
    with pytest.raises(ValueError, match="Provide imageBase64"):
        MealAnalysisRequest.model_validate({})


def test_meal_analysis_request_rejects_an_excessive_combined_encoded_payload() -> None:
    image = "A" * (8 * 1024 * 1024 + 2 * 1024)

    with pytest.raises(ValueError, match="totaling 18 MB"):
        MealAnalysisRequest.model_validate({"imagesBase64": [image, image, image]})


def make_food(
    *,
    display_name: str,
    data_type: str,
    calories: float,
    carbs: float,
) -> FoodSearchResult:
    return FoodSearchResult(
        id=f"usda:{display_name}",
        display_name=display_name,
        provider=ProviderName.usda,
        external_id=display_name,
        data_type=data_type,
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=calories,
            protein_grams=1.1,
            carbohydrate_grams=carbs,
            fat_grams=0.3,
        ),
        record_confidence=ConfidenceTier.high,
        source_reference="https://fdc.nal.usda.gov/",
    )


def tiny_jpeg_base64(*, with_exif: bool = False) -> str:
    image = Image.new("RGB", (2, 2), color=(24, 48, 72))
    output = BytesIO()
    exif = Image.Exif()
    if with_exif:
        exif[0x010F] = "Private camera name"
    image.save(output, format="JPEG", exif=exif)
    return base64.b64encode(output.getvalue()).decode("ascii")


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
