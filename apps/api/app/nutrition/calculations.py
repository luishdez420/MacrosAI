from app.schemas.common import NutrientsPer100g


def calculate_consumed_nutrients(
    nutrients_per_100g: NutrientsPer100g,
    consumed_grams: float,
) -> NutrientsPer100g:
    scale = consumed_grams / 100
    return NutrientsPer100g(
        calories_kcal=nutrients_per_100g.calories_kcal * scale,
        protein_grams=nutrients_per_100g.protein_grams * scale,
        carbohydrate_grams=nutrients_per_100g.carbohydrate_grams * scale,
        fat_grams=nutrients_per_100g.fat_grams * scale,
        fiber_grams=_scale_optional(nutrients_per_100g.fiber_grams, scale),
        sugar_grams=_scale_optional(nutrients_per_100g.sugar_grams, scale),
        sodium_milligrams=_scale_optional(nutrients_per_100g.sodium_milligrams, scale),
    )


def energy_is_consistent(nutrients: NutrientsPer100g, tolerance_ratio: float = 0.18) -> bool:
    macro_energy = (
        nutrients.protein_grams * 4
        + nutrients.carbohydrate_grams * 4
        + nutrients.fat_grams * 9
    )

    if nutrients.calories_kcal == 0:
        return macro_energy == 0

    difference = abs(nutrients.calories_kcal - macro_energy)
    return difference / nutrients.calories_kcal <= tolerance_ratio


def _scale_optional(value: float | None, scale: float) -> float | None:
    return None if value is None else value * scale
