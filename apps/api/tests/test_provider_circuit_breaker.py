import httpx
import pytest

from app.nutrition.circuit_breaker import (
    InMemoryProviderCircuitBreaker,
    RedisProviderCircuitBreaker,
    is_transient_provider_error,
)


@pytest.mark.asyncio
async def test_memory_circuit_opens_allows_one_probe_and_recovers() -> None:
    clock = MutableClock()
    breaker = InMemoryProviderCircuitBreaker(
        failure_threshold=2,
        recovery_seconds=30,
        probe_lease_seconds=5,
        now=clock,
    )

    assert (await breaker.allow("usda")).state == "closed"
    assert await breaker.record_transient_failure("usda") == "closed"
    assert await breaker.record_transient_failure("usda") == "open"

    blocked = await breaker.allow("usda")
    assert blocked.allowed is False
    assert blocked.state == "open"
    assert blocked.retry_after_seconds == 30

    clock.value = 31
    probe = await breaker.allow("usda")
    assert probe.allowed is True
    assert probe.state == "half_open"

    assert await breaker.record_success("usda") == "closed"
    assert (await breaker.allow("usda")).state == "closed"


@pytest.mark.asyncio
async def test_redis_circuit_uses_static_provider_key_and_maps_shared_decisions() -> None:
    redis = FakeRedis(responses=[[1, 0, 0], 2, [0, 2, 30], 0])
    breaker = RedisProviderCircuitBreaker(
        redis,
        key_prefix="living-nutrition:test:provider-circuit",
        failure_threshold=3,
        recovery_seconds=30,
        probe_lease_seconds=10,
        now=lambda: 100,
    )

    assert (await breaker.allow("usda")).allowed is True
    assert await breaker.record_transient_failure("usda") == "open"
    blocked = await breaker.allow("usda")
    assert blocked.allowed is False
    assert blocked.retry_after_seconds == 30
    assert await breaker.record_success("usda") == "closed"

    keys = [str(call[2]) for call in redis.calls]
    assert keys == ["living-nutrition:test:provider-circuit:usda"] * 4
    assert all("banana" not in key and "012345" not in key for key in keys)


def test_only_transient_provider_errors_count_toward_circuit_opening() -> None:
    request = httpx.Request("GET", "https://provider.example.test/food")
    retryable_response = httpx.Response(503, request=request)
    permanent_response = httpx.Response(401, request=request)

    assert is_transient_provider_error(httpx.ConnectError("offline", request=request))
    assert is_transient_provider_error(
        httpx.HTTPStatusError("unavailable", request=request, response=retryable_response)
    )
    assert not is_transient_provider_error(
        httpx.HTTPStatusError("unauthorized", request=request, response=permanent_response)
    )


class MutableClock:
    value = 0.0

    def __call__(self) -> float:
        return self.value


class FakeRedis:
    def __init__(self, *, responses: list[object]) -> None:
        self.responses = responses
        self.calls: list[tuple[object, ...]] = []

    async def eval(self, *args: object) -> object:
        self.calls.append(args)
        return self.responses.pop(0)

    async def ping(self) -> None:
        return None

    async def aclose(self) -> None:
        return None
