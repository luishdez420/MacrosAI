from unittest.mock import AsyncMock

import pytest

from app.main import app, lifespan
from app.nutrition.provider_registry import get_provider_registry


@pytest.mark.asyncio
async def test_lifespan_discards_the_closed_provider_registry() -> None:
    """A restarted API process must not reuse a closed shared breaker client."""

    get_provider_registry.cache_clear()
    registry = get_provider_registry()
    close = AsyncMock()
    registry.close = close  # type: ignore[method-assign]

    try:
        async with lifespan(app):
            assert get_provider_registry() is registry

        assert close.await_count == 1
        assert get_provider_registry() is not registry
    finally:
        get_provider_registry.cache_clear()
