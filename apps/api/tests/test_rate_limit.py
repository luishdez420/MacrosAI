import pytest
from fastapi import FastAPI
from fastapi import Request
from tests.http_client import ApiTestClient as TestClient
from redis.exceptions import ConnectionError as RedisConnectionError

from app.api.v1 import router as api_router_module
from app.core.config import settings
from app.core.auth import CurrentUser, ensure_current_user
from app.core.middleware import RateLimitMiddleware, RequestIdMiddleware
from app.core.rate_limit import (
    InMemoryRateLimiter,
    RateLimitBackendUnavailableError,
    RateLimitCheck,
    RateLimitPolicy,
    RATE_LIMIT_ROUTE_REGISTRY,
    RedisRateLimiter,
    client_key,
    policy_for_request,
    rate_limit_checks_for_request,
)
from app.nutrition.circuit_breaker import (
    ProviderCircuitBreakerUnavailableError,
    RedisProviderCircuitBreaker,
)
from app.services.worker_heartbeats import WorkerHealthReport
from app.main import app


@pytest.mark.asyncio
async def test_rolling_window_limiter_recovers_after_window_expires() -> None:
    current_time = [100.0]
    limiter = InMemoryRateLimiter(now=lambda: current_time[0])
    policy = RateLimitPolicy(name="auth", max_requests=2, window_seconds=60)

    assert (await limiter.check("auth:127.0.0.1", policy)).allowed is True
    assert (await limiter.check("auth:127.0.0.1", policy)).allowed is True

    blocked = await limiter.check("auth:127.0.0.1", policy)
    assert blocked.allowed is False
    assert blocked.remaining == 0
    assert blocked.retry_after_seconds == 60

    current_time[0] += 60
    recovered = await limiter.check("auth:127.0.0.1", policy)
    assert recovered.allowed is True
    assert recovered.remaining == 1


@pytest.mark.asyncio
async def test_multi_scope_limiter_does_not_consume_an_ip_budget_when_user_scope_is_denied() -> None:
    limiter = InMemoryRateLimiter(now=lambda: 100.0)
    ip_policy = RateLimitPolicy(name="analysis", max_requests=3, window_seconds=60)
    user_policy = RateLimitPolicy(name="analysis-user", max_requests=1, window_seconds=60)

    first = await limiter.check_many(
        (
            RateLimitCheck(key="analysis:ip:one", policy=ip_policy),
            RateLimitCheck(key="analysis:user:one", policy=user_policy),
        )
    )
    blocked = await limiter.check_many(
        (
            RateLimitCheck(key="analysis:ip:two", policy=ip_policy),
            RateLimitCheck(key="analysis:user:one", policy=user_policy),
        )
    )

    assert first.allowed is True
    assert blocked.allowed is False
    assert blocked.limit == 1
    # The rejected multi-check did not spend the second IP's separate budget.
    assert (await limiter.check("analysis:ip:two", ip_policy)).remaining == 2


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


def test_authenticated_food_search_has_an_independent_correlated_ip_budget(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_food_search_max_requests", 1)
    monkeypatch.setattr(settings, "rate_limit_food_search_window_seconds", 60)
    protected_app = FastAPI()
    protected_app.add_middleware(RateLimitMiddleware, limiter=InMemoryRateLimiter(), settings=settings)
    protected_app.add_middleware(RequestIdMiddleware)

    @protected_app.get("/api/v1/foods/search")
    async def search_foods() -> dict[str, bool]:
        return {"ok": True}

    client = TestClient(protected_app)
    allowed = client.get("/api/v1/foods/search?query=banana")
    blocked = client.get("/api/v1/foods/search?query=banana")

    assert allowed.status_code == 200
    assert allowed.headers["x-ratelimit-limit"] == "1"
    assert blocked.status_code == 429
    assert blocked.headers["x-ratelimit-limit"] == "1"
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
    monkeypatch.setattr(settings, "rate_limit_analysis_max_requests", 2)
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(
        id="00000000-0000-4000-8000-000000000001",
        auth_scheme="test",
    )

    try:
        client = TestClient(app)
        assert client.post("/api/v1/auth/login", json={}).status_code == 422
        invalid_analysis = client.post("/api/v1/meal-analysis", json={})
        assert invalid_analysis.status_code == 422
        assert invalid_analysis.json()["error"]["code"] == "validation_error"
        assert "This request value is invalid." in str(invalid_analysis.json()["error"]["message"])
        invalid_durable_analysis = client.post("/api/v1/meal-analysis/jobs", json={})
        assert invalid_durable_analysis.status_code == 422
        assert invalid_durable_analysis.json()["error"]["code"] == "validation_error"
        assert client.get("/api/v1/health").status_code == 200

        assert client.post("/api/v1/auth/login", json={}).status_code == 429
        blocked = client.post("/api/v1/meal-analysis/jobs", json={})
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "rate_limited"
        assert blocked.headers["x-request-id"]
    finally:
        app.dependency_overrides.pop(ensure_current_user, None)


def test_validation_errors_do_not_reflect_rejected_image_content() -> None:
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(
        id="00000000-0000-4000-8000-000000000001",
        auth_scheme="test",
    )
    marker = "private-image-base64-marker"

    try:
        response = TestClient(app).post(
            "/api/v1/meal-analysis",
            json={"imageBase64": marker * 1_000_000},
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
        assert marker not in response.text
        details = response.json()["error"]["message"]
        assert all("input" not in detail for detail in details)
        assert response.headers["x-request-id"]
    finally:
        app.dependency_overrides.pop(ensure_current_user, None)


def test_analysis_user_budget_returns_a_correlated_429_before_the_ip_budget(monkeypatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_analysis_max_requests", 10)
    monkeypatch.setattr(settings, "rate_limit_analysis_user_max_requests", 1)
    app.dependency_overrides[ensure_current_user] = lambda: CurrentUser(
        id="00000000-0000-4000-8000-000000000001",
        auth_scheme="test",
    )

    try:
        client = TestClient(app)
        first = client.post("/api/v1/meal-analysis", json={})
        blocked = client.post("/api/v1/meal-analysis", json={})

        assert first.status_code == 422
        assert blocked.status_code == 429
        assert blocked.headers["x-ratelimit-limit"] == "1"
        assert blocked.headers["x-request-id"] == blocked.json()["error"]["requestId"]
    finally:
        app.dependency_overrides.pop(ensure_current_user, None)


def test_meal_analysis_requires_authentication_when_development_auth_is_disabled(monkeypatch) -> None:
    monkeypatch.setattr(settings, "allow_dev_auth", False)
    monkeypatch.setattr(settings, "identity_provider", "local")

    response = TestClient(app).post(
        "/api/v1/meal-analysis",
        json={"imageBase64": "schema-valid-but-not-an-image"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Authentication is required."
    assert response.headers["x-request-id"]


def test_rate_limit_uses_forwarded_client_address_only_for_a_trusted_proxy() -> None:
    policy = RateLimitPolicy(name="auth", max_requests=2, window_seconds=60)
    trusted_proxy_settings = settings.model_copy(
        update={"trusted_proxy_cidrs": "10.0.0.0/8,fd00::/8"}
    )
    direct_settings = settings.model_copy(update={"trusted_proxy_cidrs": ""})

    trusted_request = rate_limit_request(
        client_host="10.0.0.9",
        forwarded_for="203.0.113.44, 10.1.2.3",
    )
    assert client_key(trusted_request, policy, trusted_proxy_settings) == "auth:203.0.113.44"

    spoofed_request = rate_limit_request(
        client_host="198.51.100.9",
        forwarded_for="203.0.113.44",
    )
    assert client_key(spoofed_request, policy, trusted_proxy_settings) == "auth:198.51.100.9"

    malformed_request = rate_limit_request(
        client_host="10.0.0.9",
        forwarded_for="203.0.113.44, not-an-ip",
    )
    assert client_key(malformed_request, policy, trusted_proxy_settings) == "auth:10.0.0.9"
    assert client_key(trusted_request, policy, direct_settings) == "auth:10.0.0.9"


@pytest.mark.asyncio
async def test_redis_limiter_maps_atomic_decisions_without_storing_client_address() -> None:
    redis = FakeRedis(responses=[[1, 1, 1, 0], [0, 1, 2, 23]])
    limiter = RedisRateLimiter(
        redis,
        key_prefix="living-nutrition:test",
        now=lambda: 100.25,
        request_member=lambda: "request-one",
    )
    policy = RateLimitPolicy(name="auth", max_requests=2, window_seconds=60)

    allowed = await limiter.check("auth:127.0.0.1", policy)
    blocked = await limiter.check("auth:127.0.0.1", policy)

    assert allowed == limiter_decision(True, remaining=1, retry_after=0)
    assert blocked == limiter_decision(False, remaining=0, retry_after=23)
    assert len(redis.calls) == 2
    assert redis.calls[0][2].startswith("living-nutrition:test:auth:")
    assert "127.0.0.1" not in redis.calls[0][2]


@pytest.mark.asyncio
async def test_redis_limiter_shares_one_atomic_window_across_limiter_instances() -> None:
    redis = SharedWindowRedis()
    policy = RateLimitPolicy(name="analysis", max_requests=2, window_seconds=60)
    first_replica = RedisRateLimiter(
        redis,
        key_prefix="living-nutrition:test",
        now=lambda: 100.0,
        request_member=lambda: "replica-one",
    )
    second_replica = RedisRateLimiter(
        redis,
        key_prefix="living-nutrition:test",
        now=lambda: 100.0,
        request_member=lambda: "replica-two",
    )

    assert (await first_replica.check("analysis:203.0.113.10", policy)).allowed is True
    assert (await second_replica.check("analysis:203.0.113.10", policy)).allowed is True
    blocked = await first_replica.check("analysis:203.0.113.10", policy)

    assert blocked.allowed is False
    assert blocked.remaining == 0
    assert blocked.retry_after_seconds == 60
    assert len(redis.windows) == 1
    assert all("203.0.113.10" not in key for key in redis.windows)


@pytest.mark.asyncio
async def test_redis_limiter_applies_user_and_ip_checks_atomically_without_persisting_raw_user_id() -> None:
    redis = SharedWindowRedis()
    ip_policy = RateLimitPolicy(name="analysis", max_requests=3, window_seconds=60)
    user_policy = RateLimitPolicy(name="analysis-user", max_requests=1, window_seconds=60)
    first_replica = RedisRateLimiter(
        redis,
        key_prefix="living-nutrition:test",
        now=lambda: 100.0,
        request_member=lambda: "replica-one",
    )
    second_replica = RedisRateLimiter(
        redis,
        key_prefix="living-nutrition:test",
        now=lambda: 100.0,
        request_member=lambda: "replica-two",
    )

    assert (
        await first_replica.check_many(
            (
                RateLimitCheck(key="analysis:ip:one", policy=ip_policy),
                RateLimitCheck(key="analysis:user:usr_private", policy=user_policy),
            )
        )
    ).allowed is True
    blocked = await second_replica.check_many(
        (
            RateLimitCheck(key="analysis:ip:two", policy=ip_policy),
            RateLimitCheck(key="analysis:user:usr_private", policy=user_policy),
        )
    )

    assert blocked.allowed is False
    assert blocked.limit == 1
    assert (await second_replica.check("analysis:ip:two", ip_policy)).remaining == 2
    assert all("usr_private" not in key and "ip:one" not in key for key in redis.windows)


def test_durable_analysis_jobs_use_the_paid_analysis_rate_limit_policy() -> None:
    request = rate_limit_request(path="/api/v1/meal-analysis/jobs")

    policy = policy_for_request(request, settings)

    assert policy is not None
    assert policy.name == "analysis"


def test_authenticated_catalog_search_uses_its_ip_rate_limit_policy() -> None:
    request = rate_limit_request(path="/api/v1/foods/search", method="GET")

    plan = rate_limit_checks_for_request(
        request,
        settings,
        authenticated_user_id="usr_private",
    )

    assert plan is not None
    operation, checks = plan
    assert operation.name == "food-search"
    assert [check.policy.name for check in checks] == ["food-search"]
    assert checks[0].key == "food-search:127.0.0.1"


def test_rate_limit_route_registry_has_no_ambiguous_method_path_entries() -> None:
    protected_routes = [
        (rule.method, path)
        for rule in RATE_LIMIT_ROUTE_REGISTRY
        for path in rule.paths
    ]

    assert len(protected_routes) == len(set(protected_routes))
    assert ("GET", "/api/v1/foods/search") in protected_routes
    assert ("POST", "/api/v1/meal-analysis/jobs") in protected_routes


def test_analysis_limit_plan_combines_ip_and_authenticated_user_budgets() -> None:
    request = rate_limit_request(path="/api/v1/meal-analysis/jobs")

    plan = rate_limit_checks_for_request(
        request,
        settings,
        authenticated_user_id="usr_private",
    )

    assert plan is not None
    operation, checks = plan
    assert operation.name == "analysis"
    assert [check.policy.name for check in checks] == ["analysis", "analysis-user"]
    assert checks[0].key == "analysis:127.0.0.1"
    assert checks[1].key == "analysis:user:usr_private"


def test_auth_limit_plan_does_not_create_a_user_budget_from_a_presented_credential() -> None:
    request = rate_limit_request(path="/api/v1/auth/login")

    plan = rate_limit_checks_for_request(
        request,
        settings,
        authenticated_user_id="usr_private",
    )

    assert plan is not None
    operation, checks = plan
    assert operation.name == "auth"
    assert [check.policy.name for check in checks] == ["auth"]


@pytest.mark.asyncio
async def test_redis_limiter_surfaces_backend_failure_without_failing_open() -> None:
    limiter = RedisRateLimiter(
        FailingRedis(),
        key_prefix="living-nutrition:test",
    )
    policy = RateLimitPolicy(name="auth", max_requests=2, window_seconds=60)

    with pytest.raises(RateLimitBackendUnavailableError):
        await limiter.check("auth:127.0.0.1", policy)


def test_rate_limit_backend_failure_uses_safe_error_envelope() -> None:
    protected_app = FastAPI()
    protected_app.add_middleware(RateLimitMiddleware, limiter=FailingLimiter(), settings=settings)
    protected_app.add_middleware(RequestIdMiddleware)

    @protected_app.post("/api/v1/auth/login")
    async def login() -> dict[str, bool]:
        return {"ok": True}

    response = TestClient(protected_app).post("/api/v1/auth/login")

    assert response.status_code == 503
    assert response.headers["x-request-id"]
    assert response.json() == {
        "error": {
            "message": "Request protection is temporarily unavailable. Please try again shortly.",
            "code": "rate_limit_unavailable",
            "requestId": response.headers["x-request-id"],
        }
    }


def test_readiness_fails_closed_when_the_configured_redis_limiter_is_unavailable(monkeypatch) -> None:
    class UnavailableRedisRateLimiter(RedisRateLimiter):
        async def ping(self) -> None:
            raise RateLimitBackendUnavailableError("Redis is unavailable")

    unavailable_limiter = UnavailableRedisRateLimiter(FailingRedis(), key_prefix="living-nutrition:test")
    monkeypatch.setattr(app.state, "rate_limiter", unavailable_limiter)
    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )

    response = TestClient(app).get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.headers["x-request-id"]
    assert response.json() == {
        "ok": False,
        "database": {"healthy": True},
        "rateLimiter": {"backend": "redis", "healthy": False},
        "providerCircuit": {"backend": "memory", "healthy": True},
        "backgroundWorkers": {
            "required": False,
            "healthy": True,
            "backend": "disabled",
            "workers": {},
        },
        "requestId": response.headers["x-request-id"],
    }


def test_readiness_reports_a_healthy_preview_limiter(monkeypatch) -> None:
    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )
    response = TestClient(app).get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["rateLimiter"] == {"backend": "memory", "healthy": True}
    assert response.json()["providerCircuit"] == {"backend": "memory", "healthy": True}


def test_readiness_reports_an_unavailable_shared_provider_circuit(monkeypatch) -> None:
    class UnavailableProviderCircuit:
        circuit_breaker = RedisProviderCircuitBreaker(
            CircuitRedisUnavailable(),
            key_prefix="living-nutrition:test:provider-circuit",
            failure_threshold=3,
            recovery_seconds=30,
            probe_lease_seconds=10,
        )

        async def ping(self) -> None:
            raise ProviderCircuitBreakerUnavailableError("Redis is unavailable")

    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )
    monkeypatch.setattr(api_router_module, "get_provider_registry", UnavailableProviderCircuit)

    response = TestClient(app).get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json()["providerCircuit"] == {"backend": "redis", "healthy": False}
    assert response.json()["requestId"] == response.headers["x-request-id"]


def test_readiness_fails_closed_when_a_required_background_worker_is_missing(monkeypatch) -> None:
    monkeypatch.setattr(settings, "background_worker_heartbeats_required", True)
    monkeypatch.setattr(
        api_router_module,
        "database_health",
        lambda: {"connected": True, "schemaReady": True},
    )
    monkeypatch.setattr(
        api_router_module,
        "background_worker_health",
        lambda: WorkerHealthReport(
            required=True,
            healthy=False,
            backend="database",
            workers={
                "meal_analysis": True,
                "image_retention": False,
                "food_source_refresh": True,
            },
        ),
    )

    response = TestClient(app).get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json()["backgroundWorkers"] == {
        "required": True,
        "healthy": False,
        "backend": "database",
        "workers": {
            "meal_analysis": True,
            "image_retention": False,
            "food_source_refresh": True,
        },
    }
    assert response.json()["requestId"] == response.headers["x-request-id"]


def limiter_decision(allowed: bool, *, remaining: int, retry_after: int):
    from app.core.rate_limit import RateLimitDecision

    return RateLimitDecision(
        allowed=allowed,
        limit=2,
        remaining=remaining,
        retry_after_seconds=retry_after,
    )


class FakeRedis:
    def __init__(self, *, responses: list[list[int]]) -> None:
        self.responses = responses
        self.calls: list[tuple[object, ...]] = []

    async def eval(self, *args: object) -> list[int]:
        self.calls.append(args)
        return self.responses.pop(0)


class FailingRedis:
    async def eval(self, *args: object) -> list[int]:
        raise RedisConnectionError("Redis is unavailable")


class CircuitRedisUnavailable:
    async def ping(self) -> None:
        raise RedisConnectionError("Redis is unavailable")


class FailingLimiter:
    async def check(self, key: str, policy: RateLimitPolicy):
        raise RateLimitBackendUnavailableError("Redis is unavailable")

    async def check_many(self, checks: tuple[RateLimitCheck, ...]):
        raise RateLimitBackendUnavailableError("Redis is unavailable")


class SharedWindowRedis:
    """Minimal Redis-EVAL model used to prove replica-shared limiter behavior."""

    def __init__(self) -> None:
        self.windows: dict[str, list[tuple[float, str]]] = {}

    async def eval(self, _script: str, key_count: int, *arguments: str) -> list[int]:
        keys = arguments[:key_count]
        values = arguments[key_count:]
        timestamp = float(values[0])
        prepared: list[tuple[str, float, int, str, list[tuple[float, str]]]] = []

        for index, key in enumerate(keys):
            offset = 1 + (index * 3)
            window_seconds = float(values[offset])
            maximum = int(values[offset + 1])
            member = values[offset + 2]
            entries = [
                entry for entry in self.windows.get(key, []) if entry[0] > timestamp - window_seconds
            ]
            self.windows[key] = entries
            if len(entries) >= maximum:
                oldest = min(entries, key=lambda entry: entry[0])[0]
                return [0, index + 1, len(entries), max(1, int((oldest + window_seconds - timestamp) + 0.999))]
            prepared.append((key, window_seconds, maximum, member, entries))

        for key, _window_seconds, _maximum, member, entries in prepared:
            entries.append((timestamp, member))
            self.windows[key] = entries

        return [1, 1, len(prepared[0][4]), 0]


def rate_limit_request(
    *,
    client_host: str = "127.0.0.1",
    forwarded_for: str | None = None,
    path: str = "/api/v1/auth/login",
    method: str = "POST",
) -> Request:
    headers = []
    if forwarded_for:
        headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))

    return Request(
        {
            "type": "http",
            "method": method,
            "scheme": "https",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": headers,
            "client": (client_host, 443),
            "server": ("api.example.test", 443),
        }
    )
