from app.nutrition.food_quality import FoodQualitySignal, FoodQualityStatus, assess_food_quality
from app.nutrition.providers.usda import _quality_flags
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName


def test_complete_provider_record_has_an_explainable_complete_assessment() -> None:
    assessment = assess_food_quality("usda", [])

    assert assessment.status == FoodQualityStatus.complete
    assert assessment.signals == (FoodQualitySignal.provider_record,)
    assert assessment.is_blocking is False


def test_stale_conflicting_record_requires_review_without_blocking_gram_logging() -> None:
    assessment = assess_food_quality(
        "open_food_facts",
        ["stale_source_record", "duplicate_nutrition_conflict", "serving_per_100g_conflict"],
    )

    assert assessment.status == FoodQualityStatus.needs_review
    assert set(assessment.signals) == {
        FoodQualitySignal.provider_record,
        FoodQualitySignal.stale_source,
        FoodQualitySignal.conflicting_data,
        FoodQualitySignal.serving_basis_issue,
    }
    assert assessment.is_blocking is False


def test_incomplete_or_invalid_per_100g_data_is_blocked_and_forces_low_confidence() -> None:
    result = FoodSearchResult(
        id="open_food_facts:blocked",
        display_name="Incomplete cereal",
        provider=ProviderName.open_food_facts,
        external_id="blocked",
        data_type="packaged_food",
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=0,
            protein_grams=0,
            carbohydrate_grams=0,
            fat_grams=0,
        ),
        quality_flags=["incomplete_per_100g"],
        record_confidence=ConfidenceTier.high,
        source_reference="https://example.test/blocked",
    )

    assert result.quality_assessment is not None
    assert result.quality_assessment.status == FoodQualityStatus.insufficient_data
    assert result.quality_assessment.is_blocking is True
    assert result.record_confidence == ConfidenceTier.low


def test_user_record_is_distinguished_without_downgrading_explicit_user_confirmation() -> None:
    result = FoodSearchResult(
        id="user:pantry",
        display_name="My pantry mix",
        provider=ProviderName.user,
        external_id="pantry",
        data_type="custom_food",
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=200,
            protein_grams=10,
            carbohydrate_grams=15,
            fat_grams=8,
        ),
        record_confidence=ConfidenceTier.verified,
        source_reference="User-entered food",
    )

    assert result.quality_assessment is not None
    assert result.quality_assessment.status == FoodQualityStatus.user_entered
    assert result.quality_assessment.signals == [FoodQualitySignal.user_entered]
    assert result.record_confidence == ConfidenceTier.verified


def test_usda_quality_flags_core_nutrients_missing_from_source_payload() -> None:
    nutrients = NutrientsPer100g(
        calories_kcal=89,
        protein_grams=1.1,
        carbohydrate_grams=22.8,
        fat_grams=0.3,
    )

    flags = _quality_flags(
        {
            "description": "Incomplete USDA record",
            "foodNutrients": [
                {"nutrient": {"number": "1008"}, "amount": 89},
                {"nutrient": {"number": "203"}, "amount": 1.1},
            ],
        },
        nutrients,
    )

    assert "incomplete_per_100g" in flags
