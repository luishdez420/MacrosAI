from collections.abc import Iterable

import structlog
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text

from app.core.config import API_ROOT, settings
from app.db.base import Base
from app.db.session import engine
import app.models  # noqa: F401

logger = structlog.get_logger(__name__)

# Before the API used Alembic for Postgres, phone preview created its SQLite
# schema with ``Base.metadata.create_all``. That creates missing tables but does
# not alter existing ones, so a preview database can be missing a newer column.
# Keep these additive repairs explicit and limited to that legacy local path.
LEGACY_SQLITE_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("users", "password_hash", "VARCHAR(512)"),
    ("auth_sessions", "device_label", "VARCHAR(96)"),
    ("meal_items", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
    ("recipe_items", "sort_order", "INTEGER NOT NULL DEFAULT 0"),
    ("meals", "idempotency_key", "VARCHAR(128)"),
    ("meals", "meal_type", "VARCHAR(32) NOT NULL DEFAULT 'meal'"),
    ("recipes", "meal_type", "VARCHAR(32) NOT NULL DEFAULT 'meal'"),
    ("user_preferences", "goal_direction", "VARCHAR(16) NOT NULL DEFAULT 'maintain'"),
    ("user_preferences", "onboarding_goal", "VARCHAR(32)"),
    ("user_preferences", "logging_preference", "VARCHAR(32)"),
    ("user_preferences", "dietary_preferences", "JSON NOT NULL DEFAULT '[]'"),
    ("user_preferences", "theme_preference", "VARCHAR(16) NOT NULL DEFAULT 'system'"),
    ("food_source_records", "refresh_attempted_at", "DATETIME"),
    ("food_source_records", "refresh_not_before", "DATETIME"),
    ("food_source_records", "refresh_failure_count", "INTEGER NOT NULL DEFAULT 0"),
    ("data_correction_reports", "resolution_summary", "TEXT"),
    ("data_correction_reports", "source_revision_id", "VARCHAR(36)"),
    ("data_correction_reports", "reviewed_by_user_id", "VARCHAR(36)"),
    ("data_correction_reports", "updated_at", "DATETIME"),
)


def run_database_migrations() -> None:
    if is_sqlite_url(settings.database_url):
        bootstrap_sqlite_schema(engine)
        return

    alembic_ini = API_ROOT / "alembic.ini"
    alembic_dir = API_ROOT / "alembic"
    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(alembic_dir))
    config.set_main_option("sqlalchemy.url", settings.database_url)

    logger.info("database_migration_start", target="head")
    command.upgrade(config, "head")
    logger.info("database_migration_complete", target="head")


def is_sqlite_url(database_url: str) -> bool:
    return database_url.startswith("sqlite")


def bootstrap_sqlite_schema(database_engine: Engine) -> None:
    """Create and safely repair the local SQLite schema used by phone preview.

    SQLite preview databases predate the Alembic migration history. New tables
    can be created from the current metadata, while known legacy columns are
    added in place. This preserves local meals and accounts during development.
    """

    logger.info("database_schema_bootstrap_start", dialect="sqlite")
    Base.metadata.create_all(bind=database_engine)

    repaired_columns = add_missing_sqlite_columns(database_engine, LEGACY_SQLITE_COLUMNS)
    repair_legacy_correction_report_history(database_engine)
    backfill_legacy_audit_deliveries(database_engine)
    logger.info(
        "database_schema_bootstrap_complete",
        dialect="sqlite",
        repaired_columns=repaired_columns,
    )


def add_missing_sqlite_columns(
    database_engine: Engine,
    columns: Iterable[tuple[str, str, str]],
) -> list[str]:
    """Add explicitly approved nullable columns to a legacy SQLite database."""

    inspector = inspect(database_engine)
    table_names = set(inspector.get_table_names())
    repaired_columns: list[str] = []

    with database_engine.begin() as connection:
        for table_name, column_name, column_definition in columns:
            if table_name not in table_names:
                continue

            column_names = {column["name"] for column in inspector.get_columns(table_name)}
            if column_name in column_names:
                continue

            # The table/column names and definition are internal constants, not user input.
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")
            )
            repaired_columns.append(f"{table_name}.{column_name}")

    return repaired_columns


def repair_legacy_correction_report_history(database_engine: Engine) -> None:
    """Backfill preview report history after an additive schema upgrade.

    Preview SQLite databases do not run Alembic. Existing reports need a safe
    initial status event and non-null update timestamp before owner responses
    can include the new history fields.
    """

    inspector = inspect(database_engine)
    tables = set(inspector.get_table_names())
    required_tables = {"data_correction_reports", "data_correction_report_status_events"}
    if not required_tables.issubset(tables):
        return

    with database_engine.begin() as connection:
        connection.execute(
            text(
                """
                UPDATE data_correction_reports
                SET updated_at = created_at
                WHERE updated_at IS NULL
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO data_correction_report_status_events
                  (id, correction_report_id, status, user_visible_summary, created_at)
                SELECT
                  report.id,
                  report.id,
                  report.status,
                  CASE WHEN report.status = 'open' THEN 'Report submitted.' ELSE NULL END,
                  report.created_at
                FROM data_correction_reports AS report
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM data_correction_report_status_events AS event
                  WHERE event.correction_report_id = report.id
                )
                """
            )
        )


def backfill_legacy_audit_deliveries(database_engine: Engine) -> None:
    """Give existing local audit rows an outbox record without changing event data."""

    inspector = inspect(database_engine)
    tables = set(inspector.get_table_names())
    if not {"audit_logs", "audit_deliveries"}.issubset(tables):
        return

    with database_engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO audit_deliveries
                  (id, audit_log_id, status, attempts, created_at)
                SELECT
                  lower(hex(randomblob(16))), audit.id, 'pending', 0, audit.created_at
                FROM audit_logs AS audit
                WHERE NOT EXISTS (
                  SELECT 1
                  FROM audit_deliveries AS delivery
                  WHERE delivery.audit_log_id = audit.id
                )
                """
            )
        )
