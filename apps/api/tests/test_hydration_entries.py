from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
import app.models as _models  # noqa: F401


def test_hydration_entry_can_be_created_read_updated_and_deleted() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        missing = client.get("/api/v1/hydration/2026-07-13")
        assert missing.status_code == 200
        assert missing.json() is None

        created = client.put(
            "/api/v1/hydration/2026-07-13",
            json={"milliliters": 750},
        )
        assert created.status_code == 200
        assert created.json()["milliliters"] == 750
        assert created.json()["loggedOn"] == "2026-07-13"

        updated = client.put(
            "/api/v1/hydration/2026-07-13",
            json={"milliliters": 1250},
        )
        assert updated.status_code == 200
        assert updated.json()["id"] == created.json()["id"]
        assert updated.json()["milliliters"] == 1250

        fetched = client.get("/api/v1/hydration/2026-07-13")
        assert fetched.status_code == 200
        assert fetched.json()["milliliters"] == 1250

        invalid = client.put(
            "/api/v1/hydration/2026-07-13",
            json={"milliliters": 0},
        )
        assert invalid.status_code == 422

        deleted = client.delete("/api/v1/hydration/2026-07-13")
        assert deleted.status_code == 204
        assert client.get("/api/v1/hydration/2026-07-13").json() is None
    finally:
        app.dependency_overrides.clear()
