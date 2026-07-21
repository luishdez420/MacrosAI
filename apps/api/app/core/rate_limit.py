"""Rate limiting for sensitive API endpoints.

Development uses a small in-memory rolling window. Production requires the
Redis implementation so independently deployed API processes share one atomic
limit without exposing client addresses in Redis keys.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from ipaddress import IPv4Address, IPv4Network, IPv6Address, IPv6Network, ip_address, ip_network
from time import monotonic, time
from typing import Protocol
from uuid import uuid4

from fastapi import Request
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings


@dataclass(frozen=True)
class RateLimitPolicy:
    name: str
    max_requests: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int


@dataclass(frozen=True)
class RateLimitCheck:
    """One independently scoped limit evaluated for a request."""

    key: str
    policy: RateLimitPolicy


@dataclass(frozen=True)
class RateLimitOperation:
    """The stable, low-cardinality limits attached to a protected operation."""

    name: str
    ip_policy: RateLimitPolicy
    user_policy: RateLimitPolicy | None = None


@dataclass(frozen=True)
class RateLimitRouteRule:
    """A stable method/path group and the operation policy it creates.

    Keeping this registry declarative makes every protected route reviewable in
    one place. The policy builder reads deployment-managed settings at request
    time, so tests and local preview overrides retain their existing behavior.
    """

    method: str
    paths: frozenset[str]
    operation_builder: Callable[[Settings], RateLimitOperation]


class RateLimitBackendUnavailableError(RuntimeError):
    """Raised when a configured shared limiter cannot make a safe decision."""


class RateLimiter(Protocol):
    async def check(self, key: str, policy: RateLimitPolicy) -> RateLimitDecision:
        """Record one request and return its decision."""

    async def check_many(self, checks: tuple[RateLimitCheck, ...]) -> RateLimitDecision:
        """Atomically record every scoped check or reject the request."""


class InMemoryRateLimiter:
    """A single-process rolling-window limiter for local and phone preview."""

    def __init__(self, now: Callable[[], float] = monotonic) -> None:
        self._now = now
        self._requests: dict[str, deque[float]] = {}

    async def check(self, key: str, policy: RateLimitPolicy) -> RateLimitDecision:
        return await self.check_many((RateLimitCheck(key=key, policy=policy),))

    async def check_many(self, checks: tuple[RateLimitCheck, ...]) -> RateLimitDecision:
        if not checks:
            raise ValueError("At least one rate-limit check is required.")

        now = self._now()
        timestamps_by_check: list[deque[float]] = []

        # Evaluate every scope before mutating any of them. This mirrors the
        # Redis transaction and keeps preview behavior honest for multi-key
        # production enforcement.
        for check in checks:
            window_start = now - check.policy.window_seconds
            timestamps = self._requests.setdefault(check.key, deque())
            while timestamps and timestamps[0] <= window_start:
                timestamps.popleft()
            if len(timestamps) >= check.policy.max_requests:
                oldest = timestamps[0]
                retry_after = max(1, int((oldest + check.policy.window_seconds - now) + 0.999))
                return RateLimitDecision(
                    allowed=False,
                    limit=check.policy.max_requests,
                    remaining=0,
                    retry_after_seconds=retry_after,
                )
            timestamps_by_check.append(timestamps)

        for timestamps in timestamps_by_check:
            timestamps.append(now)

        primary_check = checks[0]
        primary_timestamps = timestamps_by_check[0]
        return RateLimitDecision(
            allowed=True,
            limit=primary_check.policy.max_requests,
            remaining=max(primary_check.policy.max_requests - len(primary_timestamps), 0),
            retry_after_seconds=0,
        )

    def reset(self) -> None:
        self._requests.clear()


class RedisRateLimiter:
    """An atomic Redis sorted-set rolling window shared across API replicas."""

    _CHECK_MANY_SCRIPT = """
local now = tonumber(ARGV[1])

-- First perform a read-only capacity pass. If any scope is exhausted, do not
-- record this request in the other scopes.
for index = 1, #KEYS do
  local offset = 2 + ((index - 1) * 3)
  local window = tonumber(ARGV[offset])
  local limit = tonumber(ARGV[offset + 1])
  local cutoff = now - window
  local key = KEYS[index]

  redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
  local count = redis.call('ZCARD', key)
  if count >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retry_after = math.max(1, math.ceil((tonumber(oldest[2]) + window) - now))
    redis.call('EXPIRE', key, math.ceil(window))
    return {0, index, count, retry_after}
  end
end

-- Every scope has capacity, so record the request in all of them together.
for index = 1, #KEYS do
  local offset = 2 + ((index - 1) * 3)
  local window = tonumber(ARGV[offset])
  local member = ARGV[offset + 2]
  local key = KEYS[index]
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, math.ceil(window))
end

local first_count = redis.call('ZCARD', KEYS[1])
return {1, 1, first_count, 0}
"""

    def __init__(
        self,
        client: Redis,
        *,
        key_prefix: str,
        now: Callable[[], float] = time,
        request_member: Callable[[], str] = lambda: uuid4().hex,
    ) -> None:
        self._client = client
        self._key_prefix = key_prefix.rstrip(":")
        self._now = now
        self._request_member = request_member

    async def check(self, key: str, policy: RateLimitPolicy) -> RateLimitDecision:
        return await self.check_many((RateLimitCheck(key=key, policy=policy),))

    async def check_many(self, checks: tuple[RateLimitCheck, ...]) -> RateLimitDecision:
        if not checks:
            raise ValueError("At least one rate-limit check is required.")

        now = f"{self._now():.6f}"
        keys = [self._redis_key(check.key, check.policy) for check in checks]
        arguments: list[str] = [now]
        for check in checks:
            arguments.extend(
                [
                    str(check.policy.window_seconds),
                    str(check.policy.max_requests),
                    self._request_member(),
                ]
            )

        try:
            response = await self._client.eval(
                self._CHECK_MANY_SCRIPT,
                len(keys),
                *keys,
                *arguments,
            )
        except RedisError as exc:
            raise RateLimitBackendUnavailableError(
                "The shared rate-limit service is unavailable."
            ) from exc

        try:
            allowed, check_index, count, retry_after = (int(value) for value in response)
            matched_check = checks[check_index - 1]
        except (IndexError, TypeError, ValueError) as exc:
            raise RateLimitBackendUnavailableError(
                "The shared rate-limit service returned an invalid decision."
            ) from exc

        return RateLimitDecision(
            allowed=bool(allowed),
            limit=matched_check.policy.max_requests,
            remaining=max(matched_check.policy.max_requests - count, 0),
            retry_after_seconds=max(0, retry_after),
        )

    async def ping(self) -> None:
        try:
            await self._client.ping()
        except RedisError as exc:
            raise RateLimitBackendUnavailableError(
                "The shared rate-limit service is unavailable."
            ) from exc

    async def close(self) -> None:
        await self._client.aclose()

    def _redis_key(self, key: str, policy: RateLimitPolicy) -> str:
        digest = sha256(key.encode("utf-8")).hexdigest()
        return f"{self._key_prefix}:{policy.name}:{digest}"


def build_rate_limiter(settings: Settings) -> RateLimiter:
    if settings.rate_limit_backend == "redis":
        return RedisRateLimiter(
            Redis.from_url(settings.redis_url, decode_responses=True),
            key_prefix=settings.rate_limit_redis_key_prefix,
        )

    return InMemoryRateLimiter()


def policy_for_request(request: Request, settings: Settings) -> RateLimitPolicy | None:
    operation = operation_for_request(request, settings)
    return operation.ip_policy if operation else None


def auth_operation(settings: Settings) -> RateLimitOperation:
    return RateLimitOperation(
        name="auth",
        ip_policy=RateLimitPolicy(
            name="auth",
            max_requests=settings.rate_limit_auth_max_requests,
            window_seconds=settings.rate_limit_auth_window_seconds,
        ),
    )


def food_search_operation(settings: Settings) -> RateLimitOperation:
    return RateLimitOperation(
        name="food-search",
        ip_policy=RateLimitPolicy(
            name="food-search",
            max_requests=settings.rate_limit_food_search_max_requests,
            window_seconds=settings.rate_limit_food_search_window_seconds,
        ),
    )


def analysis_operation(settings: Settings) -> RateLimitOperation:
    return RateLimitOperation(
        name="analysis",
        ip_policy=RateLimitPolicy(
            name="analysis",
            max_requests=settings.rate_limit_analysis_max_requests,
            window_seconds=settings.rate_limit_analysis_window_seconds,
        ),
        user_policy=RateLimitPolicy(
            name="analysis-user",
            max_requests=settings.rate_limit_analysis_user_max_requests,
            window_seconds=settings.rate_limit_analysis_user_window_seconds,
        ),
    )


RATE_LIMIT_ROUTE_REGISTRY: tuple[RateLimitRouteRule, ...] = (
    RateLimitRouteRule(
        method="POST",
        paths=frozenset(
            {
                "/api/v1/auth/register",
                "/api/v1/auth/login",
                "/api/v1/auth/refresh",
                "/api/v1/auth/logout",
                "/api/v1/auth/password",
            }
        ),
        operation_builder=auth_operation,
    ),
    RateLimitRouteRule(
        method="GET",
        paths=frozenset({"/api/v1/foods/search"}),
        operation_builder=food_search_operation,
    ),
    RateLimitRouteRule(
        method="POST",
        paths=frozenset(
            {
                "/api/v1/meal-analysis",
                "/api/v1/meal-analysis/jobs",
                "/api/v1/foods/label-analysis",
            }
        ),
        operation_builder=analysis_operation,
    ),
)


def operation_for_request(request: Request, settings: Settings) -> RateLimitOperation | None:
    if not settings.rate_limit_enabled:
        return None

    path = request.url.path
    method = request.method.upper()

    for rule in RATE_LIMIT_ROUTE_REGISTRY:
        if rule.method == method and path in rule.paths:
            return rule.operation_builder(settings)

    return None


def client_key(request: Request, policy: RateLimitPolicy, settings: Settings) -> str:
    """Build an ephemeral key from a safely resolved client address."""

    host = client_address(request, settings)
    return f"{policy.name}:{host}"


def rate_limit_checks_for_request(
    request: Request,
    settings: Settings,
    *,
    authenticated_user_id: str | None = None,
) -> tuple[RateLimitOperation, tuple[RateLimitCheck, ...]] | None:
    """Return the operation's IP check and optional authenticated-user check.

    Raw identifiers exist only long enough to derive an ephemeral limiter key.
    Redis hashes this full key before persistence; callers must never log it.
    """

    operation = operation_for_request(request, settings)
    if operation is None:
        return None

    checks = [
        RateLimitCheck(
            key=client_key(request, operation.ip_policy, settings),
            policy=operation.ip_policy,
        )
    ]
    if authenticated_user_id and operation.user_policy:
        checks.append(
            RateLimitCheck(
                key=f"{operation.name}:user:{authenticated_user_id}",
                policy=operation.user_policy,
            )
        )

    return operation, tuple(checks)


def client_address(request: Request, settings: Settings) -> str:
    """Resolve a client IP only when the direct peer is explicitly trusted.

    `X-Forwarded-For` is user-controlled at the application boundary. It is
    considered only when the socket peer belongs to the configured proxy CIDR
    allowlist, and a malformed chain safely falls back to the direct peer.
    The standard `Forwarded` header is intentionally unsupported here so there
    is one small, testable proxy contract for deployment operators.
    """

    direct_host = request.client.host if request.client else "unknown"
    direct_address = parse_ip_address(direct_host)
    trusted_networks = trusted_proxy_networks(settings.trusted_proxy_cidrs)

    if not direct_address or not address_is_trusted_proxy(direct_address, trusted_networks):
        return direct_host

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return direct_host

    forwarded_addresses = [parse_ip_address(value.strip()) for value in forwarded.split(",")]
    if not forwarded_addresses or any(address is None for address in forwarded_addresses):
        return direct_host

    # Walk backward through the proxy chain. The first address outside the
    # explicitly trusted proxy networks is the client address supplied by the
    # nearest trusted proxy. If every entry is a proxy, retain the direct peer.
    for address in reversed(forwarded_addresses):
        if address and not address_is_trusted_proxy(address, trusted_networks):
            return str(address)

    return direct_host


def trusted_proxy_networks(value: str) -> tuple[IPv4Network | IPv6Network, ...]:
    return tuple(ip_network(cidr, strict=False) for cidr in value.split(",") if cidr)


def parse_ip_address(value: str) -> IPv4Address | IPv6Address | None:
    try:
        return ip_address(value)
    except ValueError:
        return None


def address_is_trusted_proxy(
    address: IPv4Address | IPv6Address,
    networks: tuple[IPv4Network | IPv6Network, ...],
) -> bool:
    return any(address.version == network.version and address in network for network in networks)
