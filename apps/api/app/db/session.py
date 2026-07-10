from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


def engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True}

    if database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}

    return options


engine = create_engine(settings.database_url, **engine_options(settings.database_url))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
