from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine

REQUIRED_TABLES = {
    "users",
    "auth_sessions",
    "food_source_records",
    "audit_deliveries",
    "worker_heartbeats",
    "meals",
    "meal_items",
    "user_preferences",
}

# A table-only readiness check can incorrectly pass after a metadata bootstrap
# when a later nullable column has not been added to an existing SQLite table.
REQUIRED_COLUMNS = {
    "users": {"password_hash", "auth_provider"},
    "auth_sessions": {"refresh_token_hash", "device_label", "expires_at"},
    "user_preferences": {"goal_direction", "dietary_preferences", "theme_preference"},
}


def database_health() -> dict[str, object]:
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
            inspector = inspect(connection)
            table_names = set(inspector.get_table_names())
            missing_columns = {
                table_name: sorted(
                    required_columns
                    - {column["name"] for column in inspector.get_columns(table_name)}
                )
                for table_name, required_columns in REQUIRED_COLUMNS.items()
                if table_name in table_names
            }
    except SQLAlchemyError as exc:
        return {
            "connected": False,
            "schemaReady": False,
            "missingTables": sorted(REQUIRED_TABLES),
            "error": exc.__class__.__name__,
        }

    missing_tables = sorted(REQUIRED_TABLES - table_names)
    missing_columns = {
        table_name: column_names
        for table_name, column_names in missing_columns.items()
        if column_names
    }

    return {
        "connected": True,
        "schemaReady": not missing_tables and not missing_columns,
        "missingTables": missing_tables,
        "missingColumns": missing_columns,
    }
