"""Deterministic nutrition records used only by device E2E builds.

The fixture provider deliberately implements the same provider contract as
USDA/Open Food Facts. It is selected only through ``E2E_FIXTURE_MODE`` and is
rejected by production configuration, so device tests never need live food
providers or a paid API key.
"""

from datetime import datetime, timezone

import httpx

from app.nutrition.provider import NutritionProvider
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName

E2E_MATCHING_BARCODE = "000000000001"
E2E_PROVIDER_OUTAGE_QUERY = "fixture provider outage"
E2E_RATE_LIMIT_QUERY = "fixture rate limit"


class E2EFixtureNutritionProvider(NutritionProvider):
    """Small, stable data set for end-to-end mobile coverage."""

    # Reuse the USDA namespace so normal provider-detail routing, source
    # badges, and persisted meal snapshots follow the production code path.
    name = "usda"

    def __init__(self) -> None:
        self._foods = (
            _food(
                external_id="e2e-banana-raw",
                display_name="Banana, raw",
                nutrients=NutrientsPer100g(
                    calories_kcal=89,
                    protein_grams=1.09,
                    carbohydrate_grams=22.84,
                    fat_grams=0.33,
                    fiber_grams=2.6,
                    sugar_grams=12.23,
                    sodium_milligrams=1,
                ),
                serving_size=118,
                household_serving_text="1 medium banana (118 g)",
            ),
            _food(
                external_id="e2e-chicken-grilled",
                display_name="Chicken breast, grilled",
                nutrients=NutrientsPer100g(
                    calories_kcal=165,
                    protein_grams=31,
                    carbohydrate_grams=0,
                    fat_grams=3.6,
                    fiber_grams=0,
                    sugar_grams=0,
                    sodium_milligrams=74,
                ),
                serving_size=140,
                household_serving_text="1 grilled breast portion (140 g)",
            ),
            _food(
                external_id="e2e-protein-bar",
                display_name="Living Nutrition fixture protein bar",
                nutrients=NutrientsPer100g(
                    calories_kcal=400,
                    protein_grams=25,
                    carbohydrate_grams=45,
                    fat_grams=14,
                    fiber_grams=8,
                    sugar_grams=6,
                    sodium_milligrams=220,
                ),
                serving_size=50,
                household_serving_text="1 bar (50 g)",
                data_type="Branded",
                brand_owner="Living Nutrition test fixtures",
            ),
        )

    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        normalized_query = _normalized_search_text(query)
        if not normalized_query:
            return []

        if normalized_query == E2E_PROVIDER_OUTAGE_QUERY:
            # Exercise the normal registry, error-envelope, and phone recovery
            # path without connecting to an external provider in device tests.
            request = httpx.Request("GET", "https://fixture-provider.invalid/search")
            raise httpx.ConnectError("Fixture provider is unavailable", request=request)

        return [
            food
            for food in self._foods
            if normalized_query in _normalized_search_text(food.display_name)
            or normalized_query
            in _normalized_search_text(food.external_id.replace("e2e-", "").replace("-", " "))
        ]

    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        return next((food for food in self._foods if food.external_id == external_id), None)

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        if barcode == E2E_MATCHING_BARCODE:
            return next(food for food in self._foods if food.external_id == "e2e-protein-bar")
        return None


def _normalized_search_text(value: str) -> str:
    normalized = "".join(
        character if character.isalnum() else " " for character in value.lower()
    )
    return " ".join(normalized.split())


def _food(
    *,
    external_id: str,
    display_name: str,
    nutrients: NutrientsPer100g,
    serving_size: float,
    household_serving_text: str,
    data_type: str = "Foundation",
    brand_owner: str | None = None,
) -> FoodSearchResult:
    return FoodSearchResult(
        id=f"usda:{external_id}",
        display_name=display_name,
        provider=ProviderName.usda,
        external_id=external_id,
        data_type=data_type,
        brand_owner=brand_owner,
        serving_size=serving_size,
        serving_size_unit="g",
        household_serving_text=household_serving_text,
        nutrients_per_100g=nutrients,
        original_nutrient_ids={
            "calories_kcal": "1008",
            "protein_grams": "203",
            "carbohydrate_grams": "205",
            "fat_grams": "204",
        },
        quality_flags=[],
        record_confidence=ConfidenceTier.verified,
        source_reference="https://fdc.nal.usda.gov/",
        retrieved_at=datetime.now(timezone.utc),
    )
