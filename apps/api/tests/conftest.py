import pytest

from app.core.config import settings
from app.core.metrics import metrics
from app.main import rate_limiter


@pytest.fixture(autouse=True)
def reset_process_local_rate_limiter() -> None:
    """Keep request history isolated because the preview limiter is process-local."""

    rate_limiter.reset()
    yield
    rate_limiter.reset()


@pytest.fixture(autouse=True)
def reset_process_local_metrics() -> None:
    """Keep per-process Prometheus samples isolated between API tests."""

    metrics.reset_for_tests()
    yield
    metrics.reset_for_tests()


@pytest.fixture(autouse=True)
def isolate_auth_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep local-fixture tests independent from a developer's Clerk `.env` file."""

    monkeypatch.setattr(settings, "identity_provider", "local")
    monkeypatch.setattr(settings, "allow_dev_auth", True)
    monkeypatch.setattr(settings, "allow_legacy_local_tokens", True)
    monkeypatch.setattr(settings, "jwt_secret", "test-jwt-secret-that-is-at-least-thirty-two-characters")
