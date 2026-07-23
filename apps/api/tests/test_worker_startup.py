import pytest

from app.workers import startup


def test_worker_startup_repairs_an_incomplete_local_schema_when_auto_migration_is_enabled(
    monkeypatch,
) -> None:
    health_responses = iter(
        (
            {"connected": True, "schemaReady": False},
            {"connected": True, "schemaReady": True},
        )
    )
    migration_calls: list[bool] = []

    monkeypatch.setattr(startup, "database_health", lambda: next(health_responses))
    monkeypatch.setattr(startup.settings, "auto_migrate_on_startup", True)
    monkeypatch.setattr(startup, "run_database_migrations", lambda: migration_calls.append(True))

    startup.ensure_worker_database_ready()

    assert migration_calls == [True]


def test_worker_startup_fails_once_with_clear_guidance_when_schema_is_incomplete(monkeypatch) -> None:
    monkeypatch.setattr(startup, "database_health", lambda: {"connected": True, "schemaReady": False})
    monkeypatch.setattr(startup.settings, "auto_migrate_on_startup", False)

    with pytest.raises(startup.WorkerDatabaseNotReadyError, match="Worker database schema is not ready"):
        startup.ensure_worker_database_ready()
