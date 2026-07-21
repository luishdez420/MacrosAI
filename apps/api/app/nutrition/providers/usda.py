from datetime import date, datetime, timezone

from app.core.config import settings
from app.nutrition.calculations import energy_is_consistent
from app.nutrition.provider import NutritionProvider
from app.nutrition.provider_http import ProviderHttpClient
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName

USDA_NUTRIENT_MAP = {
    "1008": "calories_kcal",
    "208": "calories_kcal",
    "203": "protein_grams",
    "205": "carbohydrate_grams",
    "204": "fat_grams",
    "291": "fiber_grams",
    "269": "sugar_grams",
    "307": "sodium_milligrams",
}


class UsdaFoodDataCentralProvider(NutritionProvider):
    name = "usda"
    base_url = "https://api.nal.usda.gov/fdc/v1"

    def __init__(self, http_client: ProviderHttpClient | None = None) -> None:
        self.http_client = http_client or ProviderHttpClient()

    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        response = await self.http_client.request(
            "POST",
            f"{self.base_url}/foods/search",
            params={"api_key": settings.usda_api_key},
            json={
                "query": query,
                "pageSize": 10,
                "dataType": ["Branded", "Foundation", "Survey (FNDDS)", "SR Legacy"],
            },
        )
        response.raise_for_status()

        payload = response.json()
        return [self._from_search_item(item) for item in payload.get("foods", [])]

    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        response = await self.http_client.request(
            "GET",
            f"{self.base_url}/food/{external_id}",
            params={"api_key": settings.usda_api_key},
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()
        return self._from_food_detail(response.json())

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        results = await self.search_foods(query=barcode, locale="en-US")
        return results[0] if results else None

    def _from_search_item(self, item: dict) -> FoodSearchResult:
        nutrients = _extract_nutrients(item.get("foodNutrients", []))
        return FoodSearchResult(
            id=f"usda:{item['fdcId']}",
            display_name=item.get("description") or "Unnamed USDA food",
            provider=ProviderName.usda,
            external_id=str(item["fdcId"]),
            data_type=item.get("dataType", "unknown"),
            brand_owner=item.get("brandOwner"),
            publication_date=_parse_date(item.get("publicationDate")),
            serving_size=item.get("servingSize"),
            serving_size_unit=item.get("servingSizeUnit"),
            household_serving_text=item.get("householdServingFullText"),
            nutrients_per_100g=nutrients,
            original_nutrient_ids=_original_nutrient_ids(item.get("foodNutrients", [])),
            quality_flags=_quality_flags(item, nutrients),
            record_confidence=_confidence_for_item(item, nutrients),
            source_reference=f"https://fdc.nal.usda.gov/fdc-app.html#/food-details/{item['fdcId']}/nutrients",
            retrieved_at=datetime.now(timezone.utc),
        )

    def _from_food_detail(self, item: dict) -> FoodSearchResult:
        return self._from_search_item(
            {
                **item,
                "fdcId": item["fdcId"],
                "foodNutrients": item.get("foodNutrients", []),
            }
        )


def _extract_nutrients(food_nutrients: list[dict]) -> NutrientsPer100g:
    values: dict[str, float] = {}

    for nutrient in food_nutrients:
        nutrient_info = nutrient.get("nutrient") or {}
        number = str(nutrient_info.get("number") or nutrient.get("nutrientNumber") or "")
        field = USDA_NUTRIENT_MAP.get(number)

        if field:
            values[field] = float(nutrient.get("amount") or nutrient.get("value") or 0)

    return NutrientsPer100g(
        calories_kcal=values.get("calories_kcal", 0),
        protein_grams=values.get("protein_grams", 0),
        carbohydrate_grams=values.get("carbohydrate_grams", 0),
        fat_grams=values.get("fat_grams", 0),
        fiber_grams=values.get("fiber_grams"),
        sugar_grams=values.get("sugar_grams"),
        sodium_milligrams=values.get("sodium_milligrams"),
    )


def _original_nutrient_ids(food_nutrients: list[dict]) -> dict[str, str]:
    ids: dict[str, str] = {}

    for nutrient in food_nutrients:
        nutrient_info = nutrient.get("nutrient") or {}
        number = str(nutrient_info.get("number") or nutrient.get("nutrientNumber") or "")
        field = USDA_NUTRIENT_MAP.get(number)

        if field:
            ids[field] = number

    return ids


def _quality_flags(item: dict, nutrients: NutrientsPer100g) -> list[str]:
    flags: list[str] = []

    if not item.get("description"):
        flags.append("missing_name")

    required_numbers = {"203", "205", "204"}
    nutrient_numbers = {
        str((nutrient.get("nutrient") or {}).get("number") or nutrient.get("nutrientNumber") or "")
        for nutrient in item.get("foodNutrients", [])
    }
    has_energy = bool(nutrient_numbers.intersection({"1008", "208"}))
    if not has_energy or not required_numbers.issubset(nutrient_numbers):
        flags.append("incomplete_per_100g")

    if not energy_is_consistent(nutrients):
        flags.append("energy_macro_mismatch")

    if item.get("servingSize") == 0:
        flags.append("zero_serving_size")

    values = nutrients.model_dump()
    if any(value is not None and value < 0 for value in values.values()):
        flags.append("negative_nutrient")

    if nutrients.calories_kcal > 1500:
        flags.append("possible_kj_confusion")

    return flags


def _confidence_for_item(item: dict, nutrients: NutrientsPer100g) -> ConfidenceTier:
    if not item.get("description"):
        return ConfidenceTier.low

    if not energy_is_consistent(nutrients):
        return ConfidenceTier.low

    data_type = item.get("dataType")

    if data_type in {"Foundation", "Branded"}:
        return ConfidenceTier.high

    if data_type in {"Survey (FNDDS)", "SR Legacy"}:
        return ConfidenceTier.medium

    return ConfidenceTier.low


def _parse_date(value: object) -> date | None:
    if not value:
        return None

    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None
