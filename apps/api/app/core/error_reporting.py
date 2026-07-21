"""Privacy-minimized Sentry-compatible server error reporting."""

from collections.abc import Mapping
from typing import Any, cast

import sentry_sdk
from sentry_sdk.types import Event, Hint
import structlog

from app.core.config import Settings

logger = structlog.get_logger(__name__)

_enabled = False
_ALLOWED_TAGS = frozenset({"request_id", "error_source"})


def configure_error_reporting(settings: Settings) -> None:
    """Enable Sentry only when a deployment explicitly supplies a DSN.

    Nutrition records, photos, authentication values, routes, request bodies,
    device identity, and user identity are deliberately excluded. The API's
    request ID is the only request-level correlation value that may be sent.
    """

    global _enabled
    _enabled = bool(settings.sentry_dsn)

    if not _enabled:
        logger.info("error_reporting_disabled")
        return

    sentry_sdk.init(
        dsn=str(settings.sentry_dsn),
        environment=settings.environment,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=0.0,
        before_send=sanitize_sentry_event,
    )
    logger.info(
        "error_reporting_configured",
        backend="sentry",
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
    )


def sanitize_sentry_event(event: Event, _hint: Hint) -> Event | None:
    """Strip all SDK-collected request and identity context before delivery."""

    sanitized: dict[str, Any] = dict(event)
    tags = sanitized.get("tags")
    safe_tags = (
        {
            key: value
            for key, value in tags.items()
            if isinstance(key, str)
            and key in _ALLOWED_TAGS
            and isinstance(value, (str, int, float, bool))
        }
        if isinstance(tags, Mapping)
        else {}
    )

    sanitized["tags"] = safe_tags
    sanitized.pop("request", None)
    sanitized.pop("user", None)
    sanitized.pop("breadcrumbs", None)
    sanitized.pop("contexts", None)
    sanitized.pop("extra", None)
    return cast(Event, sanitized)


def capture_unexpected_exception(exc: Exception, *, request_id: str | None = None) -> None:
    """Capture a server failure without adding request or account details."""

    if not _enabled:
        return

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("error_source", "api")
        if request_id:
            scope.set_tag("request_id", request_id)
        sentry_sdk.capture_exception(exc)


def capture_startup_exception(exc: Exception) -> None:
    """Capture lifecycle failures that do not have a request ID."""

    if not _enabled:
        return

    with sentry_sdk.push_scope() as scope:
        scope.set_tag("error_source", "api_startup")
        sentry_sdk.capture_exception(exc)
