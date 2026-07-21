from functools import lru_cache
from time import monotonic

import httpx

from app.core.metrics import metrics
from app.core.config import settings
from app.nutrition.circuit_breaker import (
    InMemoryProviderCircuitBreaker,
    ProviderCircuitBreaker,
    ProviderCircuitBreakerUnavailableError,
    build_provider_circuit_breaker,
    is_transient_provider_error,
)
from app.nutrition.provider import NutritionProvider, NutritionProviderUnavailableError
from app.nutrition.providers.e2e_fixture import E2EFixtureNutritionProvider
from app.nutrition.providers.open_food_facts import OpenFoodFactsProvider
from app.nutrition.providers.usda import UsdaFoodDataCentralProvider
from app.schemas.food import FoodSearchResponse, FoodSearchResult


class NutritionProviderRegistry:
    def __init__(
        self,
        providers: list[NutritionProvider],
        circuit_breaker: ProviderCircuitBreaker | None = None,
    ) -> None:
        self.providers = providers
        self.circuit_breaker = circuit_breaker or InMemoryProviderCircuitBreaker(
            failure_threshold=3,
            recovery_seconds=30,
            probe_lease_seconds=10,
        )

    async def search_foods(self, query: str, locale: str) -> FoodSearchResponse:
        items: list[FoodSearchResult] = []
        provider_errors: list[Exception] = []

        for provider in self.providers:
            if not await self._provider_is_available(provider.name, "search"):
                provider_errors.append(RuntimeError("Provider circuit is open."))
                continue
            started_at = monotonic()
            try:
                provider_items = await provider.search_foods(query=query, locale=locale)
            except httpx.HTTPError as exc:
                await self._record_provider_failure(provider.name, exc)
                metrics.record_nutrition_provider_request(
                    provider=provider.name,
                    operation="search",
                    outcome="error",
                    duration_seconds=monotonic() - started_at,
                )
                provider_errors.append(exc)
                continue
            await self._record_provider_success(provider.name)
            metrics.record_nutrition_provider_request(
                provider=provider.name,
                operation="search",
                outcome="success" if provider_items else "empty",
                duration_seconds=monotonic() - started_at,
            )
            items.extend(provider_items)

        if provider_errors and not items:
            raise NutritionProviderUnavailableError(
                "No nutrition provider completed the food search."
            ) from provider_errors[-1]

        return FoodSearchResponse(items=rank_food_results(items, query))

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        provider_errors: list[Exception] = []
        completed_lookup = False

        for provider in self.providers:
            if not await self._provider_is_available(provider.name, "barcode"):
                provider_errors.append(RuntimeError("Provider circuit is open."))
                continue
            started_at = monotonic()
            try:
                result = await provider.get_food_by_barcode(barcode)
            except httpx.HTTPError as exc:
                await self._record_provider_failure(provider.name, exc)
                metrics.record_nutrition_provider_request(
                    provider=provider.name,
                    operation="barcode",
                    outcome="error",
                    duration_seconds=monotonic() - started_at,
                )
                provider_errors.append(exc)
                continue

            completed_lookup = True
            await self._record_provider_success(provider.name)
            metrics.record_nutrition_provider_request(
                provider=provider.name,
                operation="barcode",
                outcome="success" if result else "empty",
                duration_seconds=monotonic() - started_at,
            )
            if result:
                return result

        if provider_errors and not completed_lookup:
            raise NutritionProviderUnavailableError(
                "No nutrition provider completed the barcode lookup."
            ) from provider_errors[-1]

        return None

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        provider_name, _, external_id = food_id.partition(":")

        if not provider_name or not external_id:
            return None

        for provider in self.providers:
            if provider.name == provider_name:
                if not await self._provider_is_available(provider.name, "detail"):
                    raise NutritionProviderUnavailableError(
                        "The requested nutrition provider is temporarily unavailable."
                    )
                started_at = monotonic()
                try:
                    result = await provider.get_food_by_external_id(external_id)
                except httpx.HTTPError as exc:
                    await self._record_provider_failure(provider.name, exc)
                    metrics.record_nutrition_provider_request(
                        provider=provider.name,
                        operation="detail",
                        outcome="error",
                        duration_seconds=monotonic() - started_at,
                    )
                    raise NutritionProviderUnavailableError(
                        "The requested nutrition provider is temporarily unavailable."
                    ) from exc
                await self._record_provider_success(provider.name)
                metrics.record_nutrition_provider_request(
                    provider=provider.name,
                    operation="detail",
                    outcome="success" if result else "empty",
                    duration_seconds=monotonic() - started_at,
                )
                return result

        return None

    async def ping(self) -> None:
        await self.circuit_breaker.ping()

    async def close(self) -> None:
        await self.circuit_breaker.close()

    async def _provider_is_available(self, provider: str, operation: str) -> bool:
        try:
            decision = await self.circuit_breaker.allow(provider)
        except ProviderCircuitBreakerUnavailableError as exc:
            metrics.record_nutrition_provider_request(
                provider=provider,
                operation=operation,
                outcome="circuit_unavailable",
                duration_seconds=0,
            )
            raise NutritionProviderUnavailableError(
                "Nutrition provider health is temporarily unavailable."
            ) from exc

        metrics.set_nutrition_provider_circuit_state(provider=provider, state=decision.state)
        if decision.allowed:
            return True

        metrics.record_nutrition_provider_request(
            provider=provider,
            operation=operation,
            outcome="circuit_open",
            duration_seconds=0,
        )
        return False

    async def _record_provider_success(self, provider: str) -> None:
        try:
            state = await self.circuit_breaker.record_success(provider)
        except ProviderCircuitBreakerUnavailableError:
            # The response was valid, so preserve it even if only the optional
            # circuit-state reset failed. The next call fails safely if Redis is
            # still unavailable before it can invoke an external provider.
            return
        metrics.set_nutrition_provider_circuit_state(provider=provider, state=state)

    async def _record_provider_failure(self, provider: str, error: httpx.HTTPError) -> None:
        if not is_transient_provider_error(error):
            return
        try:
            state = await self.circuit_breaker.record_transient_failure(provider)
        except ProviderCircuitBreakerUnavailableError:
            return
        metrics.set_nutrition_provider_circuit_state(provider=provider, state=state)


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
    if settings.e2e_fixture_mode:
        return NutritionProviderRegistry(providers=[E2EFixtureNutritionProvider()])

    return NutritionProviderRegistry(
        providers=[
            UsdaFoodDataCentralProvider(),
            OpenFoodFactsProvider(),
        ],
        circuit_breaker=build_provider_circuit_breaker(settings),
    )
