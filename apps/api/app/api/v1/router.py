from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.api.v1 import (
    admin_routes,
    auth_routes,
    diary_routes,
    food_routes,
    goal_routes,
    hydration_routes,
    insight_routes,
    meal_analysis_routes,
    meal_routes,
    preference_routes,
    recipe_routes,
    user_data_routes,
    weight_routes,
)
from app.db.health import database_health
from app.core.middleware import get_request_id
from app.core.metrics import metrics
from app.core.config import settings
from app.core.rate_limit import RateLimitBackendUnavailableError, RedisRateLimiter
from app.nutrition.circuit_breaker import (
    ProviderCircuitBreakerUnavailableError,
    RedisProviderCircuitBreaker,
)
from app.nutrition.provider_registry import get_provider_registry
from app.services.worker_heartbeats import background_worker_health

api_router = APIRouter()


@api_router.get("/health", tags=["system"])
async def api_health() -> dict[str, object]:
    database = database_health()
    return {
        "ok": bool(database["connected"]) and bool(database["schemaReady"]),
        "database": database,
    }


@api_router.get("/health/ready", tags=["system"], response_model=None)
async def api_readiness(request: Request) -> dict[str, object] | JSONResponse:
    """Report whether this API can safely accept protected production traffic.

    The response intentionally exposes only dependency category and health, not
    connection strings, Redis errors, schema details, or client information.
    """

    database = database_health()
    limiter = getattr(request.app.state, "rate_limiter", None)
    rate_limiter = {"backend": "memory", "healthy": True}
    if isinstance(limiter, RedisRateLimiter):
        rate_limiter["backend"] = "redis"
        try:
            await limiter.ping()
        except RateLimitBackendUnavailableError:
            rate_limiter["healthy"] = False

    provider_registry = get_provider_registry()
    provider_circuit = {"backend": "memory", "healthy": True}
    if isinstance(provider_registry.circuit_breaker, RedisProviderCircuitBreaker):
        provider_circuit["backend"] = "redis"
        try:
            await provider_registry.ping()
        except ProviderCircuitBreakerUnavailableError:
            provider_circuit["healthy"] = False

    database_healthy = bool(database["connected"]) and bool(database["schemaReady"])
    worker_health = (
        background_worker_health()
        if database_healthy and settings.background_worker_heartbeats_required
        else None
    )
    background_workers = (
        worker_health.to_response()
        if worker_health is not None
        else {
            "required": settings.background_worker_heartbeats_required,
            "healthy": not settings.background_worker_heartbeats_required,
            "backend": (
                "database_unavailable"
                if settings.background_worker_heartbeats_required
                else "disabled"
            ),
            "workers": {},
        }
    )
    ready = (
        database_healthy
        and rate_limiter["healthy"]
        and provider_circuit["healthy"]
        and bool(background_workers["healthy"])
    )
    payload: dict[str, object] = {
        "ok": ready,
        "database": {
            "healthy": database_healthy,
        },
        "rateLimiter": rate_limiter,
        "providerCircuit": provider_circuit,
        "backgroundWorkers": background_workers,
    }
    metrics.set_gauge(
        "living_nutrition_dependency_healthy",
        1 if database_healthy else 0,
        {"dependency": "database"},
    )
    metrics.set_gauge(
        "living_nutrition_dependency_healthy",
        1 if rate_limiter["healthy"] else 0,
        {"dependency": "rate_limiter"},
    )
    metrics.set_gauge(
        "living_nutrition_dependency_healthy",
        1 if provider_circuit["healthy"] else 0,
        {"dependency": "provider_circuit_breaker"},
    )
    for worker_name, healthy in background_workers["workers"].items():
        metrics.set_background_worker_health(worker=worker_name, healthy=bool(healthy))
    if ready:
        return payload

    payload["requestId"] = get_request_id(request)
    return JSONResponse(status_code=503, content=payload)


api_router.include_router(auth_routes.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin_routes.router, prefix="/admin", tags=["admin"])
api_router.include_router(food_routes.router, prefix="/foods", tags=["foods"])
api_router.include_router(meal_analysis_routes.router, prefix="/meal-analysis", tags=["analysis"])
api_router.include_router(meal_routes.router, prefix="/meals", tags=["meals"])
api_router.include_router(recipe_routes.router, prefix="/recipes", tags=["recipes"])
api_router.include_router(diary_routes.router, prefix="/diary", tags=["diary"])
api_router.include_router(goal_routes.router, prefix="/goals", tags=["goals"])
api_router.include_router(insight_routes.router, prefix="/insights", tags=["insights"])
api_router.include_router(preference_routes.router, prefix="/preferences", tags=["preferences"])
api_router.include_router(weight_routes.router, prefix="/weight", tags=["weight"])
api_router.include_router(hydration_routes.router, prefix="/hydration", tags=["hydration"])
api_router.include_router(user_data_routes.router, tags=["user-data"])
