from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import engine

REQUIRED_TABLES = {
    "users",
    "food_source_records",
    "meals",
    "meal_items",
}


def database_health() -> dict[str, object]:
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
            table_names = set(inspect(connection).get_table_names())
    except SQLAlchemyError as exc:
        return {
            "connected": False,
            "schemaReady": False,
            "missingTables": sorted(REQUIRED_TABLES),
            "error": exc.__class__.__name__,
        }

    missing_tables = sorted(REQUIRED_TABLES - table_names)

    return {
        "connected": True,
        "schemaReady": not missing_tables,
        "missingTables": missing_tables,
    }
