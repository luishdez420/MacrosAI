from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import structlog

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.core.middleware import RateLimitMiddleware, RequestIdMiddleware, get_request_id
from app.core.rate_limit import InMemoryRateLimiter
from app.db.migrations import run_database_migrations

configure_logging()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.auto_migrate_on_startup:
        try:
            run_database_migrations()
        except Exception:
            logger.exception("database_migration_failed")
            raise

    yield

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
rate_limiter = InMemoryRateLimiter()
app.add_middleware(RateLimitMiddleware, limiter=rate_limiter, settings=settings)
# Add request IDs last so rate-limit responses carry the same correlation header.
app.add_middleware(RequestIdMiddleware)

app.include_router(api_router, prefix="/api/v1")


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
        content=error_envelope(request, exc.errors(), code="validation_error"),
    )


@app.exception_handler(Exception)
async def unexpected_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unexpected_server_error",
        request_id=get_request_id(request),
        path=str(request.url.path),
        error_type=exc.__class__.__name__,
    )
    return JSONResponse(
        status_code=500,
        content=error_envelope(request, "Unexpected server error.", code=exc.__class__.__name__),
    )


@app.get("/health", tags=["system"])
async def health() -> dict[str, bool]:
    return {"ok": True}


def error_envelope(request: Request, message: object, code: str) -> dict[str, object]:
    return {
        "error": {
            "message": message,
            "code": code,
            "requestId": get_request_id(request),
        }
    }
