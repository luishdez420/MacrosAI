from time import monotonic
from uuid import uuid4

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
import structlog

from app.core.config import Settings
from app.core.auth import get_current_user
from app.core.metrics import metrics
from app.core.rate_limit import (
    RateLimitBackendUnavailableError,
    RateLimiter,
    rate_limit_checks_for_request,
)

REQUEST_ID_STATE_KEY = "request_id"
logger = structlog.get_logger(__name__)


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response


class MetricsMiddleware(BaseHTTPMiddleware):
    """Record low-cardinality request metrics without collecting user data."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        started_at = monotonic()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            route = request.scope.get("route")
            route_path = getattr(route, "path", None)
            if isinstance(route_path, str) and request.url.path.startswith("/api/v1/"):
                route_path = f"/api/v1{route_path}"
            # Never use the raw URL as a metric label: it can include user IDs,
            # barcodes, search terms, and unbounded cardinality.
            metrics.record_http_request(
                method=request.method,
                route=route_path if isinstance(route_path, str) else "unmatched",
                status_code=status_code,
                duration_seconds=monotonic() - started_at,
            )


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limiter: RateLimiter, settings: Settings) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._limiter = limiter
        self._settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        limit_plan = rate_limit_checks_for_request(
            request,
            self._settings,
            authenticated_user_id=rate_limit_principal(request),
        )
        if limit_plan is None:
            return await call_next(request)

        operation, checks = limit_plan

        try:
            decision = await self._limiter.check_many(checks)
        except RateLimitBackendUnavailableError:
            metrics.record_rate_limit_decision(policy=operation.name, outcome="backend_unavailable")
            logger.error(
                "rate_limit_backend_unavailable",
                policy=operation.name,
                request_id=get_request_id(request),
            )
            return JSONResponse(
                status_code=503,
                content={
                    "error": {
                        "message": "Request protection is temporarily unavailable. Please try again shortly.",
                        "code": "rate_limit_unavailable",
                        "requestId": get_request_id(request),
                    }
                },
            )
        headers = {
            "x-ratelimit-limit": str(decision.limit),
            "x-ratelimit-remaining": str(decision.remaining),
        }
        if not decision.allowed:
            metrics.record_rate_limit_decision(policy=operation.name, outcome="denied")
            # Deliberately omit the resolved client key/address. Redis also
            # stores only a hash of that ephemeral limiter input.
            logger.warning(
                "rate_limit_denied",
                policy=operation.name,
                limit=decision.limit,
                retry_after_seconds=decision.retry_after_seconds,
                request_id=get_request_id(request),
            )
            headers["retry-after"] = str(decision.retry_after_seconds)
            return JSONResponse(
                status_code=429,
                content={
                    "error": {
                        "message": "Too many requests. Please wait and try again.",
                        "code": "rate_limited",
                        "requestId": get_request_id(request),
                    }
                },
                headers=headers,
            )

        metrics.record_rate_limit_decision(policy=operation.name, outcome="allowed")
        response = await call_next(request)
        for name, value in headers.items():
            response.headers[name] = value
        return response


def get_request_id(request: Request) -> str:
    return getattr(request.state, REQUEST_ID_STATE_KEY, "unknown")


def rate_limit_principal(request: Request) -> str | None:
    """Return a verified identity only for the optional user-scoped check.

    Authentication is still enforced by the route dependency. A malformed or
    expired credential cannot skip the IP budget and is not treated as a user
    identity here. The raw principal is never logged or persisted by Redis.
    """

    try:
        current_user = get_current_user(request.headers.get("authorization"))
    except (HTTPException, ValueError):
        return None
    except Exception:
        # Clerk/JWKS verification failures are handled by the protected route.
        # The request remains subject to its IP limit without leaking details.
        return None

    return current_user.external_subject if current_user.auth_scheme == "clerk" else current_user.id
