import httpx
import pytest

from app.core.metrics import metrics
from app.nutrition.circuit_breaker import InMemoryProviderCircuitBreaker
from app.nutrition.provider import NutritionProvider, NutritionProviderUnavailableError
from app.nutrition.providers.e2e_fixture import (
    E2EFixtureNutritionProvider,
    E2E_MATCHING_BARCODE,
    E2E_PROVIDER_OUTAGE_QUERY,
)
from app.nutrition.provider_registry import NutritionProviderRegistry
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName


class UnavailableProvider(NutritionProvider):
    name = "unavailable"

    def __init__(self) -> None:
        self.search_calls = 0

    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        self.search_calls += 1
        raise provider_error()

    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        raise provider_error()

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        raise provider_error()


class FallbackProvider(NutritionProvider):
    name = "fallback"

    def __init__(self) -> None:
        self.search_calls = 0

    async def search_foods(self, query: str, locale: str) -> list[FoodSearchResult]:
        self.search_calls += 1
        return [food_result()]

    async def get_food_by_external_id(self, external_id: str) -> FoodSearchResult | None:
        return food_result()

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        return food_result()


@pytest.mark.asyncio
async def test_registry_uses_next_provider_after_barcode_http_failure() -> None:
    registry = NutritionProviderRegistry([UnavailableProvider(), FallbackProvider()])

    result = await registry.get_food_by_barcode("0123456789012")

    assert result is not None
    assert result.id == "usda:123"


@pytest.mark.asyncio
async def test_registry_uses_next_provider_after_search_http_failure() -> None:
    registry = NutritionProviderRegistry([UnavailableProvider(), FallbackProvider()])

    response = await registry.search_foods("apple", "en-US")

    assert [item.id for item in response.items] == ["usda:123"]
    metric_output = metrics.render_prometheus()
    assert (
        'living_nutrition_nutrition_provider_requests_total{operation="search",outcome="error",provider="unavailable"} 1'
        in metric_output
    )
    assert (
        'living_nutrition_nutrition_provider_requests_total{operation="search",outcome="success",provider="fallback"} 1'
        in metric_output
    )
    assert "apple" not in metric_output


@pytest.mark.asyncio
async def test_registry_reports_unavailability_when_all_barcode_lookups_fail() -> None:
    registry = NutritionProviderRegistry([UnavailableProvider()])

    with pytest.raises(NutritionProviderUnavailableError):
        await registry.get_food_by_barcode("0123456789012")


@pytest.mark.asyncio
async def test_registry_skips_an_open_provider_circuit_and_uses_the_next_provider() -> None:
    unavailable = UnavailableProvider()
    fallback = FallbackProvider()
    registry = NutritionProviderRegistry(
        [unavailable, fallback],
        circuit_breaker=InMemoryProviderCircuitBreaker(
            failure_threshold=2,
            recovery_seconds=60,
            probe_lease_seconds=10,
        ),
    )

    await registry.search_foods("banana", "en-US")
    await registry.search_foods("banana", "en-US")
    response = await registry.search_foods("banana", "en-US")

    assert [item.id for item in response.items] == ["usda:123"]
    assert unavailable.search_calls == 2
    assert fallback.search_calls == 3
    metric_output = metrics.render_prometheus()
    assert (
        'living_nutrition_nutrition_provider_requests_total{operation="search",outcome="circuit_open",provider="unavailable"} 1'
        in metric_output
    )
    assert 'living_nutrition_nutrition_provider_circuit_state{provider="unavailable"} 2' in metric_output
    assert "banana" not in metric_output


@pytest.mark.asyncio
async def test_e2e_fixture_provider_supports_search_detail_and_barcode_without_network() -> None:
    provider = E2EFixtureNutritionProvider()

    search_results = await provider.search_foods("banana", "en-US")
    chicken_results = await provider.search_foods("chicken breast grilled", "en-US")
    barcode_result = await provider.get_food_by_barcode(E2E_MATCHING_BARCODE)
    detail_result = await provider.get_food_by_external_id("e2e-chicken-grilled")

    assert [food.id for food in search_results] == ["usda:e2e-banana-raw"]
    assert [food.id for food in chicken_results] == ["usda:e2e-chicken-grilled"]
    assert barcode_result is not None
    assert barcode_result.id == "usda:e2e-protein-bar"
    assert detail_result is not None
    assert detail_result.nutrients_per_100g.protein_grams == 31


@pytest.mark.asyncio
async def test_e2e_fixture_provider_exposes_a_deterministic_outage_through_the_registry() -> None:
    registry = NutritionProviderRegistry([E2EFixtureNutritionProvider()])

    with pytest.raises(NutritionProviderUnavailableError):
        await registry.search_foods(E2E_PROVIDER_OUTAGE_QUERY, "en-US")


def provider_error() -> httpx.ConnectError:
    request = httpx.Request("GET", "https://provider.example.test/food")
    return httpx.ConnectError("Provider is unavailable", request=request)


def food_result() -> FoodSearchResult:
    return FoodSearchResult(
        id="usda:123",
        display_name="Apple, raw",
        provider=ProviderName.usda,
        external_id="123",
        data_type="Foundation",
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=52,
            protein_grams=0.3,
            carbohydrate_grams=13.8,
            fat_grams=0.2,
        ),
        record_confidence=ConfidenceTier.high,
        source_reference="https://fdc.nal.usda.gov/fdc-app.html#/food-details/123/nutrients",
    )
