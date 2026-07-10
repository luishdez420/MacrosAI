"""Small, process-local rate limiting for sensitive API endpoints.

This limiter deliberately has no Redis dependency at runtime. It protects the
single-process local/preview API while keeping the future distributed limiter a
separate deployment concern.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic

from fastapi import Request

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


class InMemoryRateLimiter:
    """A rolling-window limiter keyed by client and policy.

    It is safe for the API's single event-loop process. Multiple workers or
    replicas need a shared implementation, which is intentionally not implied
    by this local preview safeguard.
    """

    def __init__(self, now: Callable[[], float] = monotonic) -> None:
        self._now = now
        self._requests: dict[str, deque[float]] = {}

    def check(self, key: str, policy: RateLimitPolicy) -> RateLimitDecision:
        now = self._now()
        window_start = now - policy.window_seconds
        timestamps = self._requests.setdefault(key, deque())

        while timestamps and timestamps[0] <= window_start:
            timestamps.popleft()

        if len(timestamps) >= policy.max_requests:
            oldest = timestamps[0]
            retry_after = max(1, int((oldest + policy.window_seconds - now) + 0.999))
            return RateLimitDecision(
                allowed=False,
                limit=policy.max_requests,
                remaining=0,
                retry_after_seconds=retry_after,
            )

        timestamps.append(now)
        return RateLimitDecision(
            allowed=True,
            limit=policy.max_requests,
            remaining=max(policy.max_requests - len(timestamps), 0),
            retry_after_seconds=0,
        )

    def reset(self) -> None:
        self._requests.clear()


def policy_for_request(request: Request, settings: Settings) -> RateLimitPolicy | None:
    if not settings.rate_limit_enabled:
        return None

    path = request.url.path
    method = request.method.upper()

    if method == "POST" and path in {
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
    }:
        return RateLimitPolicy(
            name="auth",
            max_requests=settings.rate_limit_auth_max_requests,
            window_seconds=settings.rate_limit_auth_window_seconds,
        )

    if method == "POST" and path in {
        "/api/v1/meal-analysis",
        "/api/v1/foods/label-analysis",
    }:
        return RateLimitPolicy(
            name="analysis",
            max_requests=settings.rate_limit_analysis_max_requests,
            window_seconds=settings.rate_limit_analysis_window_seconds,
        )

    return None


def client_key(request: Request, policy: RateLimitPolicy) -> str:
    """Use the direct peer address until trusted-proxy support is configured."""

    host = request.client.host if request.client else "unknown"
    return f"{policy.name}:{host}"
