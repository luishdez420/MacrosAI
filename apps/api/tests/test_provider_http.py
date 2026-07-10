import httpx
import pytest

from app.nutrition.provider_http import ProviderHttpClient
from app.nutrition.providers.open_food_facts import OpenFoodFactsProvider
from app.nutrition.providers.usda import UsdaFoodDataCentralProvider


@pytest.mark.asyncio
async def test_provider_http_retries_transient_status_and_respects_capped_retry_after() -> None:
    attempts = 0
    delays: list[float] = []

    async def sleep(delay: float) -> None:
        delays.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(429, headers={"retry-after": "30"}, request=request)
        if attempts == 2:
            return httpx.Response(503, request=request)
        return httpx.Response(200, json={"ok": True}, request=request)

    client = ProviderHttpClient(
        timeout_seconds=1,
        max_attempts=3,
        retry_backoff_seconds=0.25,
        max_retry_delay_seconds=2,
        transport=httpx.MockTransport(handler),
        sleeper=sleep,
    )

    response = await client.request("GET", "https://provider.test/food")

    assert response.status_code == 200
    assert attempts == 3
    assert delays == [2, 0.5]


@pytest.mark.asyncio
async def test_provider_http_retries_transport_failure_then_succeeds() -> None:
    attempts = 0
    delays: list[float] = []

    async def sleep(delay: float) -> None:
        delays.append(delay)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ConnectError("temporary provider outage", request=request)
        return httpx.Response(200, json={"ok": True}, request=request)

    client = ProviderHttpClient(
        timeout_seconds=1,
        max_attempts=2,
        retry_backoff_seconds=0.1,
        transport=httpx.MockTransport(handler),
        sleeper=sleep,
    )

    response = await client.request("GET", "https://provider.test/food")

    assert response.status_code == 200
    assert attempts == 2
    assert delays == [0.1]


@pytest.mark.asyncio
async def test_provider_http_does_not_retry_permanent_client_error() -> None:
    attempts = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(404, request=request)

    client = ProviderHttpClient(
        max_attempts=3,
        transport=httpx.MockTransport(handler),
    )

    response = await client.request("GET", "https://provider.test/missing")

    assert response.status_code == 404
    assert attempts == 1


@pytest.mark.asyncio
async def test_open_food_facts_uses_retry_policy_and_normalizes_match() -> None:
    attempts = 0

    async def no_sleep(delay: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(502, request=request)
        return httpx.Response(
            200,
            json={
                "status": 1,
                "product": {
                    "product_name": "Test cereal",
                    "nutriments": {
                        "energy-kcal_100g": 380,
                        "proteins_100g": 8,
                        "carbohydrates_100g": 72,
                        "fat_100g": 7,
                    },
                },
            },
            request=request,
        )

    provider = OpenFoodFactsProvider(
        ProviderHttpClient(
            max_attempts=2,
            transport=httpx.MockTransport(handler),
            sleeper=no_sleep,
        )
    )

    result = await provider.get_food_by_barcode("0123456789012")

    assert attempts == 2
    assert result is not None
    assert result.display_name == "Test cereal"


@pytest.mark.asyncio
async def test_usda_uses_retry_policy_for_search() -> None:
    attempts = 0

    async def no_sleep(delay: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.ReadTimeout("temporary timeout", request=request)
        return httpx.Response(
            200,
            json={
                "foods": [
                    {
                        "fdcId": 123,
                        "description": "Bananas, raw",
                        "dataType": "Foundation",
                        "foodNutrients": [],
                    }
                ]
            },
            request=request,
        )

    provider = UsdaFoodDataCentralProvider(
        ProviderHttpClient(
            max_attempts=2,
            transport=httpx.MockTransport(handler),
            sleeper=no_sleep,
        )
    )

    results = await provider.search_foods("banana", "en-US")

    assert attempts == 2
    assert results[0].id == "usda:123"
