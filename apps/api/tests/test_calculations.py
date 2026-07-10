from app.nutrition.calculations import calculate_consumed_nutrients, energy_is_consistent
from app.schemas.common import NutrientsPer100g


def test_calculate_consumed_nutrients_uses_per_100g_basis() -> None:
    nutrients = NutrientsPer100g(
        calories_kcal=89,
        protein_grams=1.1,
        carbohydrate_grams=22.8,
        fat_grams=0.3,
    )

    result = calculate_consumed_nutrients(nutrients, consumed_grams=118)

    assert round(result.calories_kcal, 1) == 105.0
    assert round(result.carbohydrate_grams, 1) == 26.9


def test_energy_consistency_flags_impossible_records() -> None:
    nutrients = NutrientsPer100g(
        calories_kcal=12.5,
        protein_grams=1.1,
        carbohydrate_grams=22.8,
        fat_grams=0.3,
    )

    assert energy_is_consistent(nutrients) is False
