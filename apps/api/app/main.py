from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from hmac import compare_digest

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
import structlog

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.error_reporting import capture_startup_exception, capture_unexpected_exception, configure_error_reporting
from app.core.ai_quota import AiQuotaExceededError
from app.core.logging import configure_logging
from app.core.middleware import MetricsMiddleware, RateLimitMiddleware, RequestIdMiddleware, get_request_id
from app.core.metrics import metrics
from app.core.rate_limit import (
    RateLimitBackendUnavailableError,
    RedisRateLimiter,
    build_rate_limiter,
)
from app.db.migrations import run_database_migrations
from app.nutrition.provider import NutritionProviderUnavailableError
from app.nutrition.provider_registry import get_provider_registry

configure_logging()
configure_error_reporting(settings)
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if isinstance(rate_limiter, RedisRateLimiter):
        try:
            await rate_limiter.ping()
        except RateLimitBackendUnavailableError as exc:
            logger.exception("rate_limit_backend_unavailable")
            capture_startup_exception(exc)
            raise

    provider_registry = get_provider_registry()
    try:
        await provider_registry.ping()
    except Exception as exc:
        logger.exception("provider_circuit_breaker_unavailable")
        capture_startup_exception(exc)
        raise

    if settings.auto_migrate_on_startup:
        try:
            run_database_migrations()
        except Exception as exc:
            logger.exception("database_migration_failed")
            capture_startup_exception(exc)
            raise

    try:
        yield
    finally:
        if isinstance(rate_limiter, RedisRateLimiter):
            await rate_limiter.close()
        await provider_registry.close()
        # The registry owns the circuit-breaker client. Do not let a later
        # in-process lifespan reuse a registry whose client was just closed.
        get_provider_registry.cache_clear()

app = FastAPI(
    title="Living Nutrition API",
    version="0.1.0",
    description="Nutrition tracking API with camera analysis, USDA provenance, and confidence notes.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
rate_limiter = build_rate_limiter(settings)
app.state.rate_limiter = rate_limiter
app.add_middleware(RateLimitMiddleware, limiter=rate_limiter, settings=settings)
# Request IDs remain the outermost application middleware so every metric and
# protected response can still be correlated with the client-visible header.
app.add_middleware(MetricsMiddleware)
# Add request IDs last so rate-limit responses carry the same correlation header.
app.add_middleware(RequestIdMiddleware)

app.include_router(api_router, prefix="/api/v1")


@app.exception_handler(NutritionProviderUnavailableError)
async def nutrition_provider_unavailable_handler(
    request: Request,
    _exc: NutritionProviderUnavailableError,
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content=error_envelope(
            request,
            "Nutrition records are temporarily unavailable. Please try again shortly.",
            code="nutrition_provider_unavailable",
        ),
    )


@app.exception_handler(AiQuotaExceededError)
async def ai_quota_exceeded_handler(request: Request, exc: AiQuotaExceededError) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content=error_envelope(
            request,
            "Your analysis allowance is currently used. Please try again later.",
            code="ai_quota_exceeded",
        ),
        headers={
            "Retry-After": str(exc.retry_after_seconds),
            "X-AI-Quota-Remaining": str(max(0, exc.remaining)),
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(request, str(exc.detail), code="http_error"),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        # Pydantic's default errors include the rejected ``input`` value. That
        # could be an image payload, credential, or other sensitive content,
        # so expose only stable field locations and human-readable validation
        # metadata to mobile clients.
        content=error_envelope(request, safe_validation_errors(exc), code="validation_error"),
    )


@app.exception_handler(Exception)
async def unexpected_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Do not serialize arbitrary exception messages or tracebacks here. They
    # can contain rejected image data, provider payloads, or storage paths.
    logger.error(
        "unexpected_server_error",
        request_id=get_request_id(request),
        path=str(request.url.path),
        error_type=exc.__class__.__name__,
    )
    capture_unexpected_exception(exc, request_id=get_request_id(request))
    return JSONResponse(
        status_code=500,
        content=error_envelope(request, "Unexpected server error.", code=exc.__class__.__name__),
    )


@app.get("/health", tags=["system"])
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics(request: Request) -> PlainTextResponse:
    """Expose operational metrics only when explicitly enabled.

    The deployment must keep this endpoint on a private scrape network or use
    the configured bearer token. It never emits request IDs or user data.
    """

    if not settings.metrics_enabled:
        raise HTTPException(status_code=404, detail="Not found.")

    if settings.metrics_bearer_token:
        authorization = request.headers.get("authorization", "")
        expected = f"Bearer {settings.metrics_bearer_token}"
        if not compare_digest(authorization, expected):
            raise HTTPException(status_code=404, detail="Not found.")

    return PlainTextResponse(metrics.render_prometheus(), media_type="text/plain; version=0.0.4; charset=utf-8")


def error_envelope(request: Request, message: object, code: str) -> dict[str, object]:
    return {
        "error": {
            "message": message,
            "code": code,
            "requestId": get_request_id(request),
        }
    }


def safe_validation_errors(exc: RequestValidationError) -> list[dict[str, object]]:
    """Return validation feedback without reflecting rejected request content."""

    return [
        {
            "loc": list(error.get("loc", ())),
            "msg": safe_validation_message(str(error.get("type", "validation_error"))),
            "type": str(error.get("type", "validation_error")),
        }
        for error in exc.errors()
    ]


def safe_validation_message(error_type: str) -> str:
    """Map Pydantic classes to safe feedback without forwarding validator text."""

    if error_type == "missing":
        return "This field is required."
    if error_type in {"string_too_long", "too_long"}:
        return "This value exceeds the allowed length."
    if error_type in {"string_too_short", "too_short"}:
        return "This value is shorter than the allowed length."
    if error_type.startswith("greater_than") or error_type.startswith("less_than"):
        return "This value is outside the allowed range."
    return "This request value is invalid."
