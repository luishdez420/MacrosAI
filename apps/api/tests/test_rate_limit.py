from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.rate_limit import InMemoryRateLimiter, RateLimitPolicy
from app.main import app


def test_rolling_window_limiter_recovers_after_window_expires() -> None:
    current_time = [100.0]
    limiter = InMemoryRateLimiter(now=lambda: current_time[0])
    policy = RateLimitPolicy(name="auth", max_requests=2, window_seconds=60)

    assert limiter.check("auth:127.0.0.1", policy).allowed is True
    assert limiter.check("auth:127.0.0.1", policy).allowed is True

    blocked = limiter.check("auth:127.0.0.1", policy)
    assert blocked.allowed is False
    assert blocked.remaining == 0
    assert blocked.retry_after_seconds == 60

    current_time[0] += 60
    recovered = limiter.check("auth:127.0.0.1", policy)
    assert recovered.allowed is True
    assert recovered.remaining == 1


def test_auth_rate_limit_uses_error_envelope_and_request_id(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_auth_max_requests", 2)
    monkeypatch.setattr(settings, "rate_limit_auth_window_seconds", 60)

    client = TestClient(app)
    first = client.post("/api/v1/auth/login", json={})
    second = client.post("/api/v1/auth/login", json={})
    blocked = client.post("/api/v1/auth/login", json={})

    assert first.status_code == 422
    assert second.status_code == 422
    assert blocked.status_code == 429
    assert blocked.headers["x-request-id"]
    assert blocked.headers["x-ratelimit-limit"] == "2"
    assert blocked.headers["x-ratelimit-remaining"] == "0"
    assert blocked.headers["retry-after"] == "60"
    assert blocked.json() == {
        "error": {
            "message": "Too many requests. Please wait and try again.",
            "code": "rate_limited",
            "requestId": blocked.headers["x-request-id"],
        }
    }


def test_analysis_policy_is_independent_from_auth_and_health_is_not_limited(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_auth_max_requests", 1)
    monkeypatch.setattr(settings, "rate_limit_analysis_max_requests", 1)

    client = TestClient(app)
    assert client.post("/api/v1/auth/login", json={}).status_code == 422
    assert client.post("/api/v1/meal-analysis", json={}).status_code == 422
    assert client.get("/api/v1/health").status_code == 200

    assert client.post("/api/v1/auth/login", json={}).status_code == 429
    assert client.post("/api/v1/meal-analysis", json={}).status_code == 429
