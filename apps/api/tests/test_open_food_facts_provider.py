from app.nutrition.providers.open_food_facts import (
    _has_serving_conflict,
    _quality_flags,
    _serving_basis,
)
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
