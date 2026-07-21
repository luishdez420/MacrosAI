"""Synchronous test convenience wrapper over HTTPX's supported ASGI transport.

Starlette's synchronous ``TestClient`` emits a deprecation warning with the
secure dependency range used by this project. API tests are synchronous, so
this narrow wrapper preserves their ergonomic request interface while creating
and closing an ``httpx.AsyncClient`` for each request. It deliberately does
not run application lifespan hooks implicitly, matching the previous tests'
non-context-manager use of ``TestClient``.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from starlette.types import ASGIApp


class ApiTestClient:
    """Make a single in-process ASGI request from synchronous pytest code."""

    __test__ = False

    def __init__(self, app: ASGIApp, *, raise_server_exceptions: bool = True) -> None:
        self._app = app
        self._raise_server_exceptions = raise_server_exceptions

    def get(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("POST", url, **kwargs)

    def put(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PUT", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        return self.request("DELETE", url, **kwargs)

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(
                app=self._app,
                raise_app_exceptions=self._raise_server_exceptions,
            )
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.request(method, url, **kwargs)

        return asyncio.run(send())
