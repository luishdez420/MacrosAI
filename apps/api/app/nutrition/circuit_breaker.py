"""Bounded provider circuit breakers shared by production API replicas.

Keys use only static provider names. They never contain a query, barcode, food
identifier, user identifier, or provider response. Redis is required in
production so an outage does not cause every replica to retry independently.
"""

from __future__ import annotations

from dataclasses import dataclass
from time import monotonic, time
from typing import Callable, Literal, Protocol

import httpx
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings

CircuitState = Literal["closed", "half_open", "open"]


@dataclass(frozen=True)
class CircuitDecision:
    allowed: bool
    state: CircuitState
    retry_after_seconds: int = 0


class ProviderCircuitBreakerUnavailableError(RuntimeError):
    """Raised when shared provider-health state cannot make a safe decision."""


class ProviderCircuitBreaker(Protocol):
    async def allow(self, provider: str) -> CircuitDecision:
        """Return whether a provider call may start."""

    async def record_success(self, provider: str) -> CircuitState:
        """Close the circuit after a completed provider call."""

    async def record_transient_failure(self, provider: str) -> CircuitState:
        """Record a retryable provider failure and possibly open the circuit."""

    async def ping(self) -> None:
        """Verify any shared breaker dependency is reachable."""

    async def close(self) -> None:
        """Release shared client resources when the API shuts down."""


class InMemoryProviderCircuitBreaker:
    """Single-process breaker for local preview and focused tests only."""

    def __init__(
        self,
        *,
        failure_threshold: int,
        recovery_seconds: int,
        probe_lease_seconds: int,
        now: Callable[[], float] = monotonic,
    ) -> None:
        self._failure_threshold = failure_threshold
        self._recovery_seconds = recovery_seconds
        self._probe_lease_seconds = probe_lease_seconds
        self._now = now
        self._states: dict[str, _CircuitRecord] = {}

    async def allow(self, provider: str) -> CircuitDecision:
        record = self._states.get(provider)
        if record is None or record.opened_until <= 0:
            return CircuitDecision(allowed=True, state="closed")

        now = self._now()
        if record.opened_until > now:
            return CircuitDecision(
                allowed=False,
                state="open",
                retry_after_seconds=_retry_after(record.opened_until, now),
            )

        if record.probe_until > now:
            return CircuitDecision(
                allowed=False,
                state="open",
                retry_after_seconds=_retry_after(record.probe_until, now),
            )

        record.probe_until = now + self._probe_lease_seconds
        return CircuitDecision(allowed=True, state="half_open")

    async def record_success(self, provider: str) -> CircuitState:
        self._states.pop(provider, None)
        return "closed"

    async def record_transient_failure(self, provider: str) -> CircuitState:
        record = self._states.setdefault(provider, _CircuitRecord())
        record.failures += 1
        if record.failures >= self._failure_threshold:
            record.opened_until = self._now() + self._recovery_seconds
            record.probe_until = 0
            return "open"
        return "closed"

    async def ping(self) -> None:
        return None

    async def close(self) -> None:
        return None


@dataclass
class _CircuitRecord:
    failures: int = 0
    opened_until: float = 0
    probe_until: float = 0


class RedisProviderCircuitBreaker:
    """Atomic provider breaker that shares state between API replicas."""

    _ALLOW_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local recovery = tonumber(ARGV[2])
local probe_lease = tonumber(ARGV[3])
local opened_until = tonumber(redis.call('HGET', key, 'opened_until') or '0')
local probe_until = tonumber(redis.call('HGET', key, 'probe_until') or '0')

if opened_until > now then
  return {0, 2, math.max(1, math.ceil(opened_until - now))}
end

if opened_until > 0 then
  if probe_until > now then
    return {0, 2, math.max(1, math.ceil(probe_until - now))}
  end
  redis.call('HSET', key, 'probe_until', now + probe_lease)
  redis.call('EXPIRE', key, math.ceil(recovery + probe_lease))
  return {1, 1, 0}
end

return {1, 0, 0}
"""
    _SUCCESS_SCRIPT = """
redis.call('DEL', KEYS[1])
return 0
"""
    _FAILURE_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local recovery = tonumber(ARGV[3])
local failures = redis.call('HINCRBY', key, 'failures', 1)

if failures >= threshold then
  redis.call('HSET', key, 'opened_until', now + recovery)
  redis.call('HDEL', key, 'probe_until')
  redis.call('EXPIRE', key, math.ceil(recovery))
  return 2
end

redis.call('EXPIRE', key, math.ceil(recovery))
return 0
"""

    def __init__(
        self,
        client: Redis,
        *,
        key_prefix: str,
        failure_threshold: int,
        recovery_seconds: int,
        probe_lease_seconds: int,
        now: Callable[[], float] = time,
    ) -> None:
        self._client = client
        self._key_prefix = key_prefix.rstrip(":")
        self._failure_threshold = failure_threshold
        self._recovery_seconds = recovery_seconds
        self._probe_lease_seconds = probe_lease_seconds
        self._now = now

    async def allow(self, provider: str) -> CircuitDecision:
        try:
            response = await self._client.eval(
                self._ALLOW_SCRIPT,
                1,
                self._key(provider),
                f"{self._now():.6f}",
                str(self._recovery_seconds),
                str(self._probe_lease_seconds),
            )
        except RedisError as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service is unavailable."
            ) from exc

        try:
            allowed, state_code, retry_after = (int(value) for value in response)
            return CircuitDecision(
                allowed=bool(allowed),
                state=_state_from_code(state_code),
                retry_after_seconds=max(0, retry_after),
            )
        except (TypeError, ValueError) as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service returned an invalid decision."
            ) from exc

    async def record_success(self, provider: str) -> CircuitState:
        try:
            await self._client.eval(self._SUCCESS_SCRIPT, 1, self._key(provider))
        except RedisError as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service is unavailable."
            ) from exc
        return "closed"

    async def record_transient_failure(self, provider: str) -> CircuitState:
        try:
            response = await self._client.eval(
                self._FAILURE_SCRIPT,
                1,
                self._key(provider),
                f"{self._now():.6f}",
                str(self._failure_threshold),
                str(self._recovery_seconds),
            )
        except RedisError as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service is unavailable."
            ) from exc

        try:
            return _state_from_code(int(response))
        except (TypeError, ValueError) as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service returned an invalid decision."
            ) from exc

    async def ping(self) -> None:
        try:
            await self._client.ping()
        except RedisError as exc:
            raise ProviderCircuitBreakerUnavailableError(
                "The shared provider-health service is unavailable."
            ) from exc

    async def close(self) -> None:
        await self._client.aclose()

    def _key(self, provider: str) -> str:
        # Provider names are static configuration, never user-supplied input.
        return f"{self._key_prefix}:{provider}"


def build_provider_circuit_breaker(settings: Settings) -> ProviderCircuitBreaker:
    if settings.nutrition_provider_circuit_breaker_backend == "redis":
        return RedisProviderCircuitBreaker(
            Redis.from_url(settings.redis_url, decode_responses=True),
            key_prefix=settings.nutrition_provider_circuit_breaker_redis_key_prefix,
            failure_threshold=settings.nutrition_provider_circuit_breaker_failure_threshold,
            recovery_seconds=settings.nutrition_provider_circuit_breaker_recovery_seconds,
            probe_lease_seconds=settings.nutrition_provider_circuit_breaker_probe_lease_seconds,
        )

    return InMemoryProviderCircuitBreaker(
        failure_threshold=settings.nutrition_provider_circuit_breaker_failure_threshold,
        recovery_seconds=settings.nutrition_provider_circuit_breaker_recovery_seconds,
        probe_lease_seconds=settings.nutrition_provider_circuit_breaker_probe_lease_seconds,
    )


def is_transient_provider_error(error: Exception) -> bool:
    """Only transport/retryable HTTP failures may open a provider circuit."""
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in {408, 429, 500, 502, 503, 504}
    return isinstance(error, httpx.TransportError)


def _state_from_code(value: int) -> CircuitState:
    if value == 0:
        return "closed"
    if value == 1:
        return "half_open"
    if value == 2:
        return "open"
    raise ValueError("Invalid circuit state.")


def _retry_after(until: float, now: float) -> int:
    return max(1, int((until - now) + 0.999))
