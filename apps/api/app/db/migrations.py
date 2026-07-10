import structlog
from alembic import command
from alembic.config import Config

from app.core.config import API_ROOT, settings
from app.db.base import Base
from app.db.session import engine
import app.models  # noqa: F401

logger = structlog.get_logger(__name__)


def run_database_migrations() -> None:
    if is_sqlite_url(settings.database_url):
        logger.info("database_schema_bootstrap_start", dialect="sqlite")
        Base.metadata.create_all(bind=engine)
        logger.info("database_schema_bootstrap_complete", dialect="sqlite")
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
