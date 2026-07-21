from datetime import datetime, timezone
import math
import re

from app.core.config import settings
from app.nutrition.calculations import energy_is_consistent
from app.nutrition.provider import NutritionProvider
from app.nutrition.provider_http import ProviderHttpClient
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName


class OpenFoodFactsProvider(NutritionProvider):
    name = "open_food_facts"

    def __init__(self, http_client: ProviderHttpClient | None = None) -> None:
        self.http_client = http_client or ProviderHttpClient()

    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        return []

    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        return await self.get_food_by_barcode(external_id)

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        response = await self.http_client.request(
            "GET",
            f"{settings.open_food_facts_base_url}/api/v2/product/{barcode}.json",
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        payload = response.json()

        if payload.get("status") != 1:
            return None

        product = payload.get("product", {})
        nutriments = product.get("nutriments", {})

        if not product.get("product_name"):
            return None

        nutrients = NutrientsPer100g(
            calories_kcal=_nonnegative_float_or_zero(nutriments.get("energy-kcal_100g")),
            protein_grams=_nonnegative_float_or_zero(nutriments.get("proteins_100g")),
            carbohydrate_grams=_nonnegative_float_or_zero(nutriments.get("carbohydrates_100g")),
            fat_grams=_nonnegative_float_or_zero(nutriments.get("fat_100g")),
            fiber_grams=_optional_nonnegative_float(nutriments.get("fiber_100g")),
            sugar_grams=_optional_nonnegative_float(nutriments.get("sugars_100g")),
            sodium_milligrams=_optional_nonnegative_float(nutriments.get("sodium_100g"), scale=1000),
        )
        quality_flags = _quality_flags(product, nutrients)
        serving_size, serving_size_unit, _ = _serving_basis(product)

        return FoodSearchResult(
            id=f"open_food_facts:{barcode}",
            display_name=product["product_name"],
            provider=ProviderName.open_food_facts,
            external_id=barcode,
            data_type="packaged_food",
            brand_owner=product.get("brands"),
            serving_size=serving_size,
            serving_size_unit=serving_size_unit,
            household_serving_text=product.get("serving_size"),
            nutrients_per_100g=nutrients,
            original_nutrient_ids={},
            quality_flags=quality_flags,
            record_confidence=_confidence_for_product(quality_flags),
            source_reference=f"{settings.open_food_facts_base_url}/product/{barcode}",
            retrieved_at=datetime.now(timezone.utc),
        )


def _nonnegative_float_or_zero(value: object) -> float:
    parsed = _safe_float(value)
    if parsed is None or parsed < 0:
        return 0

    return parsed


def _optional_nonnegative_float(value: object, scale: float = 1) -> float | None:
    parsed = _safe_float(value)
    if parsed is None or parsed < 0:
        return None
    return parsed * scale


def _safe_float(value: object) -> float | None:
    if value in (None, ""):
        return None

    try:
        parsed = float(str(value).strip().replace(",", "."))
    except ValueError:
        return None

    return parsed if math.isfinite(parsed) else None


def _quality_flags(product: dict, nutrients: NutrientsPer100g) -> list[str]:
    flags: list[str] = []
    nutriments = product.get("nutriments", {})
    serving_size, _serving_size_unit, serving_grams = _serving_basis(product)

    if not product.get("product_name"):
        flags.append("missing_name")

    required = [
        "energy-kcal_100g",
        "proteins_100g",
        "carbohydrates_100g",
        "fat_100g",
    ]
    missing_required = [field for field in required if nutriments.get(field) in (None, "")]
    if missing_required:
        flags.append("incomplete_per_100g")

    invalid_required = [
        field
        for field in required
        if nutriments.get(field) not in (None, "")
        and _safe_float(nutriments.get(field)) is None
    ]
    if invalid_required:
        flags.append("invalid_per_100g_value")

    if not energy_is_consistent(nutrients):
        flags.append("energy_macro_mismatch")

    if _has_negative_nutrient_values(nutriments):
        flags.append("negative_nutrient")

    if nutrients.calories_kcal > 1500:
        flags.append("possible_kj_confusion")

    has_serving_value = bool(product.get("serving_size")) or product.get("serving_quantity") not in (
        None,
        "",
    )
    if has_serving_value and serving_size == 0:
        flags.append("zero_serving_size")

    # A serving can still be displayed as descriptive text, but it must not be
    # treated as a gram-based calculation shortcut without a verified mass.
    if has_serving_value and serving_size is None:
        flags.append("unverified_serving_basis")

    if serving_grams and _has_serving_conflict(nutriments, nutrients, serving_grams):
        flags.append("serving_per_100g_conflict")

    return flags


def _has_negative_nutrient_values(nutriments: dict) -> bool:
    nutrient_keys = [
        "energy-kcal_100g",
        "proteins_100g",
        "carbohydrates_100g",
        "fat_100g",
        "fiber_100g",
        "sugars_100g",
        "sodium_100g",
    ]

    for key in nutrient_keys:
        value = _safe_float(nutriments.get(key))
        if value is not None and value < 0:
            return True

    return False


def _confidence_for_product(quality_flags: list[str]) -> ConfidenceTier:
    critical_flags = {
        "missing_name",
        "incomplete_per_100g",
        "invalid_per_100g_value",
        "energy_macro_mismatch",
        "negative_nutrient",
        "possible_kj_confusion",
    }

    if any(flag in critical_flags for flag in quality_flags):
        return ConfidenceTier.low

    # Open Food Facts is community-contributed, so even a complete record is
    # intentionally capped at medium confidence. Serving warnings do not make
    # per-100g values unusable when the user enters grams directly.
    return ConfidenceTier.medium


def _serving_basis(product: dict) -> tuple[float | None, str | None, float | None]:
    quantity = _safe_float(product.get("serving_quantity"))
    unit = str(product.get("serving_quantity_unit") or "").strip().lower()

    if quantity is not None:
        if unit in {"g", "gram", "grams"}:
            return quantity, "g", quantity

        if unit in {"ml", "milliliter", "milliliters"}:
            return quantity, "ml", None

    parsed_grams = _parse_serving_grams(product.get("serving_size"))
    if parsed_grams is not None:
        return parsed_grams, "g", parsed_grams

    return None, None, None


def _parse_serving_grams(value: object) -> float | None:
    if not isinstance(value, str):
        return None

    match = re.search(r"(\d+(?:[\.,]\d+)?)\s*g\b", value, flags=re.IGNORECASE)
    if not match:
        return None

    return _safe_float(match.group(1))


def _has_serving_conflict(
    nutriments: dict,
    nutrients: NutrientsPer100g,
    serving_grams: float,
) -> bool:
    comparisons = [
        ("energy-kcal_serving", nutrients.calories_kcal, 5),
        ("proteins_serving", nutrients.protein_grams, 1),
        ("carbohydrates_serving", nutrients.carbohydrate_grams, 1),
        ("fat_serving", nutrients.fat_grams, 1),
    ]

    for serving_key, per_100g_value, absolute_tolerance in comparisons:
        serving_value = _safe_float(nutriments.get(serving_key))
        if serving_value is None:
            continue

        expected = per_100g_value * serving_grams / 100
        tolerance = max(absolute_tolerance, abs(expected) * 0.25)
        if abs(serving_value - expected) > tolerance:
            return True

    return False
