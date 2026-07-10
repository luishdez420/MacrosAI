import pytest
from fastapi import HTTPException

from app.analysis.meal_analyzer import (
    DetectedFoodItem,
    normalize_candidate_labels,
    pick_best_food_record,
    resolve_serving,
    sanitize_base64_image,
)
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName


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


def test_sanitize_base64_image_accepts_data_url() -> None:
    assert sanitize_base64_image("data:image/jpeg;base64,/9j/4A==") == "/9j/4A=="


def test_sanitize_base64_image_rejects_non_image_data() -> None:
    with pytest.raises(HTTPException, match="JPEG, PNG, WebP, or GIF"):
        sanitize_base64_image("aGVsbG8gd29ybGQ=")


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
