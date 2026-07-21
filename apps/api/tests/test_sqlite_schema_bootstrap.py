from sqlalchemy import create_engine, inspect, text

from app.db import health
from app.db.migrations import bootstrap_sqlite_schema


def test_sqlite_bootstrap_repairs_legacy_users_password_hash_column(tmp_path) -> None:
    database_path = tmp_path / "legacy-preview.sqlite"
    database_engine = create_engine(f"sqlite+pysqlite:///{database_path}")

    with database_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE users (
                    id VARCHAR(36) PRIMARY KEY,
                    email VARCHAR(320),
                    display_name VARCHAR(160),
                    auth_provider VARCHAR(64) NOT NULL,
                    external_subject VARCHAR(256),
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )
        connection.execute(text("CREATE TABLE meal_items (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE recipe_items (id VARCHAR(36) PRIMARY KEY)"))
        connection.execute(
            text(
                """
                CREATE TABLE data_correction_reports (
                    id VARCHAR(36) PRIMARY KEY,
                    status VARCHAR(32) NOT NULL,
                    created_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE user_preferences (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL,
                    locale VARCHAR(16) NOT NULL,
                    unit_system VARCHAR(16) NOT NULL,
                    day_start_time VARCHAR(8) NOT NULL,
                    timezone VARCHAR(64) NOT NULL,
                    image_retention_days INTEGER NOT NULL,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO data_correction_reports (id, status, created_at)
                VALUES ('legacy-report', 'open', '2026-07-01 00:00:00')
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO users (id, email, auth_provider)
                VALUES ('legacy-user', 'legacy@example.test', 'dev')
                """
            )
        )

    bootstrap_sqlite_schema(database_engine)

    user_columns = {column["name"] for column in inspect(database_engine).get_columns("users")}
    assert "password_hash" in user_columns
    assert "device_label" in {
        column["name"] for column in inspect(database_engine).get_columns("auth_sessions")
    }
    assert "sort_order" in {
        column["name"] for column in inspect(database_engine).get_columns("meal_items")
    }
    assert "sort_order" in {
        column["name"] for column in inspect(database_engine).get_columns("recipe_items")
    }
    assert "goal_direction" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "onboarding_goal" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "logging_preference" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "dietary_preferences" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "theme_preference" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert {"refresh_attempted_at", "refresh_not_before", "refresh_failure_count"}.issubset(
        {column["name"] for column in inspect(database_engine).get_columns("food_source_records")}
    )
    assert "food_source_conflicts" in inspect(database_engine).get_table_names()
    assert {
        "resolution_summary",
        "source_revision_id",
        "reviewed_by_user_id",
        "updated_at",
    }.issubset(
        {column["name"] for column in inspect(database_engine).get_columns("data_correction_reports")}
    )
    assert "data_correction_report_status_events" in inspect(database_engine).get_table_names()

    with database_engine.connect() as connection:
        assert connection.execute(text("SELECT password_hash FROM users WHERE id = 'legacy-user'")).scalar() is None
        assert connection.execute(
            text(
                "SELECT user_visible_summary FROM data_correction_report_status_events "
                "WHERE correction_report_id = 'legacy-report'"
            )
        ).scalar() == "Report submitted."
        assert connection.execute(
            text("SELECT updated_at FROM data_correction_reports WHERE id = 'legacy-report'")
        ).scalar() is not None

    # The repair is safe to run at every phone-preview startup.
    bootstrap_sqlite_schema(database_engine)
    assert "password_hash" in {
        column["name"] for column in inspect(database_engine).get_columns("users")
    }
    assert "goal_direction" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "onboarding_goal" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "logging_preference" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "dietary_preferences" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }
    assert "theme_preference" in {
        column["name"] for column in inspect(database_engine).get_columns("user_preferences")
    }


def test_database_health_reports_missing_required_columns(monkeypatch, tmp_path) -> None:
    database_path = tmp_path / "health.sqlite"
    database_engine = create_engine(f"sqlite+pysqlite:///{database_path}")

    with database_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE users (
                    id VARCHAR(36) PRIMARY KEY,
                    auth_provider VARCHAR(64) NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                CREATE TABLE auth_sessions (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36)
                )
                """
            )
        )

    monkeypatch.setattr(health, "engine", database_engine)

    assert health.database_health() == {
        "connected": True,
        "schemaReady": False,
        "missingTables": [
            "audit_deliveries",
            "food_source_records",
            "meal_items",
            "meals",
            "user_preferences",
        ],
        "missingColumns": {
            "auth_sessions": ["device_label", "expires_at", "refresh_token_hash"],
            "users": ["password_hash"],
        },
    }


def test_sqlite_bootstrap_backfills_the_audit_delivery_outbox(tmp_path) -> None:
    database_path = tmp_path / "legacy-audit-preview.sqlite"
    database_engine = create_engine(f"sqlite+pysqlite:///{database_path}")

    with database_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE audit_logs (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36),
                    event_type VARCHAR(96) NOT NULL,
                    outcome VARCHAR(32) NOT NULL,
                    request_id VARCHAR(64),
                    client_fingerprint VARCHAR(64),
                    created_at DATETIME NOT NULL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO audit_logs (id, event_type, outcome, created_at)
                VALUES ('legacy-audit-event', 'auth.login', 'success', '2026-07-01 00:00:00')
                """
            )
        )

    bootstrap_sqlite_schema(database_engine)

    with database_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT audit_log_id, status, attempts FROM audit_deliveries "
                "WHERE audit_log_id = 'legacy-audit-event'"
            )
        ).one()
    assert row == ("legacy-audit-event", "pending", 0)
