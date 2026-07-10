import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.core.config import settings

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
Sleeper = Callable[[float], Awaitable[None]]


class ProviderHttpClient:
    """Applies one bounded retry policy to external nutrition provider requests."""

    def __init__(
        self,
        *,
        timeout_seconds: float | None = None,
        max_attempts: int | None = None,
        retry_backoff_seconds: float | None = None,
        max_retry_delay_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleeper: Sleeper = asyncio.sleep,
    ) -> None:
        self.timeout_seconds = timeout_seconds or settings.nutrition_provider_timeout_seconds
        self.max_attempts = max_attempts or settings.nutrition_provider_max_attempts
        self.retry_backoff_seconds = (
            settings.nutrition_provider_retry_backoff_seconds
            if retry_backoff_seconds is None
            else retry_backoff_seconds
        )
        self.max_retry_delay_seconds = (
            settings.nutrition_provider_max_retry_delay_seconds
            if max_retry_delay_seconds is None
            else max_retry_delay_seconds
        )
        self.transport = transport
        self.sleeper = sleeper

    async def request(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds,
            transport=self.transport,
        ) as client:
            for attempt in range(self.max_attempts):
                try:
                    response = await client.request(method, url, **kwargs)
                except httpx.TransportError:
                    if attempt == self.max_attempts - 1:
                        raise
                    await self.sleeper(self._retry_delay(attempt=attempt, response=None))
                    continue

                if (
                    response.status_code not in RETRYABLE_STATUS_CODES
                    or attempt == self.max_attempts - 1
                ):
                    return response

                await self.sleeper(self._retry_delay(attempt=attempt, response=response))

        raise RuntimeError("Nutrition provider request ended without a response.")

    def _retry_delay(self, *, attempt: int, response: httpx.Response | None) -> float:
        if response is not None:
            retry_after = _parse_retry_after(response.headers.get("retry-after"))
            if retry_after is not None:
                return min(retry_after, self.max_retry_delay_seconds)

        exponential_delay = self.retry_backoff_seconds * (2**attempt)
        return min(exponential_delay, self.max_retry_delay_seconds)


def _parse_retry_after(value: str | None) -> float | None:
    if value is None:
        return None

    try:
        parsed = float(value)
    except ValueError:
        return None

    return max(0, parsed)
