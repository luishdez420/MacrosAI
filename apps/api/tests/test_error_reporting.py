from contextlib import contextmanager

import app.core.error_reporting as error_reporting


def test_sentry_event_sanitizer_keeps_only_correlation_tags() -> None:
    sanitized = error_reporting.sanitize_sentry_event(
        {
            "tags": {
                "request_id": "req_123",
                "error_source": "api",
                "untrusted": "must-not-leave-the-api",
            },
            "request": {"url": "https://api.example.test/foods?query=private"},
            "user": {"id": "user_private"},
            "breadcrumbs": [{"message": "private meal"}],
            "contexts": {"device": {"name": "private device"}},
            "extra": {"payload": "private image"},
        },
        {},
    )

    assert sanitized is not None
    assert sanitized["tags"] == {"request_id": "req_123", "error_source": "api"}
    assert "request" not in sanitized
    assert "user" not in sanitized
    assert "breadcrumbs" not in sanitized
    assert "contexts" not in sanitized
    assert "extra" not in sanitized


def test_unexpected_exception_uses_only_the_request_id_tag(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class Scope:
        def set_tag(self, key: str, value: str) -> None:
            tags = captured.setdefault("tags", {})
            assert isinstance(tags, dict)
            tags[key] = value

    @contextmanager
    def push_scope():
        yield Scope()

    monkeypatch.setattr(error_reporting, "_enabled", True)
    monkeypatch.setattr(error_reporting.sentry_sdk, "push_scope", push_scope)
    monkeypatch.setattr(
        error_reporting.sentry_sdk,
        "capture_exception",
        lambda exc: captured.setdefault("exception", exc),
    )

    error = RuntimeError("sensitive provider payload must not be added as a tag")
    error_reporting.capture_unexpected_exception(error, request_id="req_456")

    assert captured["exception"] is error
    assert captured["tags"] == {"error_source": "api", "request_id": "req_456"}
