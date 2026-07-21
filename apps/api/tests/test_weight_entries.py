from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
import app.models as _models  # noqa: F401


def test_weight_entries_can_be_created_listed_and_updated_by_date() -> None:
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
        created = client.post(
            "/api/v1/weight",
            json={
                "loggedOn": "2026-07-08",
                "weightGrams": 80000,
                "notes": "Morning weigh-in.",
            },
        )
        assert created.status_code == 201
        assert created.json()["weightGrams"] == 80000

        updated = client.post(
            "/api/v1/weight",
            json={
                "loggedOn": "2026-07-08",
                "weightGrams": 79500,
                "notes": "Corrected scale reading.",
            },
        )
        assert updated.status_code == 201
        assert updated.json()["id"] == created.json()["id"]
        assert updated.json()["weightGrams"] == 79500

        entries = client.get("/api/v1/weight")
        assert entries.status_code == 200
        body = entries.json()
        assert len(body) == 1
        assert body[0]["loggedOn"] == "2026-07-08"
        assert body[0]["notes"] == "Corrected scale reading."

        deleted = client.delete("/api/v1/weight/2026-07-08")
        assert deleted.status_code == 204

        entries_after_delete = client.get("/api/v1/weight")
        assert entries_after_delete.status_code == 200
        assert entries_after_delete.json() == []
    finally:
        app.dependency_overrides.clear()
