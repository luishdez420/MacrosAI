from app.nutrition.providers.open_food_facts import (
    _confidence_for_product,
    _has_serving_conflict,
    _quality_flags,
    _serving_basis,
)
from app.schemas.common import ConfidenceTier
from app.schemas.common import NutrientsPer100g


def test_open_food_facts_serving_basis_prefers_structured_grams() -> None:
    product = {
        "serving_quantity": "40",
        "serving_quantity_unit": "g",
        "serving_size": "1 bar (45 g)",
    }

    assert _serving_basis(product) == (40.0, "g", 40.0)


def test_open_food_facts_serving_basis_parses_grams_from_label() -> None:
    product = {
        "serving_size": "1 package (30,5 g)",
    }

    assert _serving_basis(product) == (30.5, "g", 30.5)


def test_open_food_facts_quality_flags_serving_per_100g_conflicts() -> None:
    product = {
        "product_name": "Community granola bar",
        "serving_quantity": "50",
        "serving_quantity_unit": "g",
        "nutriments": {
            "energy-kcal_100g": "400",
            "proteins_100g": "10",
            "carbohydrates_100g": "60",
            "fat_100g": "12",
            "energy-kcal_serving": "90",
            "proteins_serving": "5",
            "carbohydrates_serving": "30",
            "fat_serving": "6",
        },
    }
    nutrients = NutrientsPer100g(
        calories_kcal=400,
        protein_grams=10,
        carbohydrate_grams=60,
        fat_grams=12,
    )

    assert _has_serving_conflict(product["nutriments"], nutrients, serving_grams=50)
    assert "serving_per_100g_conflict" in _quality_flags(product, nutrients)


def test_open_food_facts_quality_flags_negative_raw_values() -> None:
    product = {
        "product_name": "Incorrect community product",
        "nutriments": {
            "energy-kcal_100g": "120",
            "proteins_100g": "-2",
            "carbohydrates_100g": "20",
            "fat_100g": "3",
        },
    }
    nutrients = NutrientsPer100g(
        calories_kcal=120,
        protein_grams=0,
        carbohydrate_grams=20,
        fat_grams=3,
    )

    assert "negative_nutrient" in _quality_flags(product, nutrients)


def test_open_food_facts_flags_invalid_core_per_100g_values() -> None:
    product = {
        "product_name": "Malformed community product",
        "nutriments": {
            "energy-kcal_100g": "not available",
            "proteins_100g": "4",
            "carbohydrates_100g": "18",
            "fat_100g": "2",
        },
    }
    nutrients = NutrientsPer100g(
        calories_kcal=0,
        protein_grams=4,
        carbohydrate_grams=18,
        fat_grams=2,
    )

    flags = _quality_flags(product, nutrients)

    assert "invalid_per_100g_value" in flags
    assert _confidence_for_product(flags) == ConfidenceTier.low


def test_open_food_facts_flags_non_finite_core_per_100g_values() -> None:
    product = {
        "product_name": "Non-finite community product",
        "nutriments": {
            "energy-kcal_100g": "NaN",
            "proteins_100g": "4",
            "carbohydrates_100g": "18",
            "fat_100g": "2",
        },
    }
    nutrients = NutrientsPer100g(
        calories_kcal=0,
        protein_grams=4,
        carbohydrate_grams=18,
        fat_grams=2,
    )

    assert "invalid_per_100g_value" in _quality_flags(product, nutrients)


def test_open_food_facts_marks_unverified_serving_without_downgrading_per_100g_record() -> None:
    product = {
        "product_name": "Serving without gram basis",
        "serving_size": "1 bar",
        "nutriments": {
            "energy-kcal_100g": "400",
            "proteins_100g": "10",
            "carbohydrates_100g": "60",
            "fat_100g": "12",
        },
    }
    nutrients = NutrientsPer100g(
        calories_kcal=400,
        protein_grams=10,
        carbohydrate_grams=60,
        fat_grams=12,
    )

    flags = _quality_flags(product, nutrients)

    assert "unverified_serving_basis" in flags
    assert _confidence_for_product(flags) == ConfidenceTier.medium
