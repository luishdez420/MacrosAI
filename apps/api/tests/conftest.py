import pytest

from app.main import rate_limiter


@pytest.fixture(autouse=True)
def reset_process_local_rate_limiter() -> None:
    """Keep request history isolated because the preview limiter is process-local."""

    rate_limiter.reset()
    yield
    rate_limiter.reset()
