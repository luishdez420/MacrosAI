from uuid import uuid4

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.core.config import Settings
from app.core.rate_limit import InMemoryRateLimiter, client_key, policy_for_request

REQUEST_ID_STATE_KEY = "request_id"


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, limiter: InMemoryRateLimiter, settings: Settings) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._limiter = limiter
        self._settings = settings

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        policy = policy_for_request(request, self._settings)
        if policy is None:
            return await call_next(request)

        decision = self._limiter.check(client_key(request, policy), policy)
        headers = {
            "x-ratelimit-limit": str(decision.limit),
            "x-ratelimit-remaining": str(decision.remaining),
        }
        if not decision.allowed:
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

        response = await call_next(request)
        for name, value in headers.items():
            response.headers[name] = value
        return response


def get_request_id(request: Request) -> str:
    return getattr(request.state, REQUEST_ID_STATE_KEY, "unknown")
