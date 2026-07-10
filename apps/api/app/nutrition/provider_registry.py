from functools import lru_cache

from app.nutrition.provider import NutritionProvider
from app.nutrition.providers.open_food_facts import OpenFoodFactsProvider
from app.nutrition.providers.usda import UsdaFoodDataCentralProvider
from app.schemas.food import FoodSearchResponse, FoodSearchResult


class NutritionProviderRegistry:
    def __init__(self, providers: list[NutritionProvider]) -> None:
        self.providers = providers

    async def search_foods(self, query: str, locale: str) -> FoodSearchResponse:
        items: list[FoodSearchResult] = []

        for provider in self.providers:
            provider_items = await provider.search_foods(query=query, locale=locale)
            items.extend(provider_items)

        return FoodSearchResponse(items=rank_food_results(items, query))

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        for provider in self.providers:
            result = await provider.get_food_by_barcode(barcode)
            if result:
                return result
        return None

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        provider_name, _, external_id = food_id.partition(":")

        if not provider_name or not external_id:
            return None

        for provider in self.providers:
            if provider.name == provider_name:
                return await provider.get_food_by_external_id(external_id)

        return None


def rank_food_results(items: list[FoodSearchResult], query: str) -> list[FoodSearchResult]:
    normalized_query = query.lower().strip()

    def score(item: FoodSearchResult) -> tuple[int, str]:
        name = item.display_name.lower()
        value = 0

        if name == normalized_query:
            value += 100
        if name.startswith(normalized_query):
            value += 50
        if normalized_query in name:
            value += 25
        if item.provider == "usda":
            value += 20
        if item.record_confidence == "verified":
            value += 20

        return (-value, item.display_name)

    return sorted(items, key=score)


@lru_cache
def get_provider_registry() -> NutritionProviderRegistry:
    return NutritionProviderRegistry(
        providers=[
            UsdaFoodDataCentralProvider(),
            OpenFoodFactsProvider(),
        ]
    )
