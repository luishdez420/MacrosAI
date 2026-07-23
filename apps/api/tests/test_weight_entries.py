from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.idempotency import IdempotencyRecord
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


def test_weight_entry_replays_an_exact_idempotent_save_and_rejects_changed_reuse() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        headers = {"Idempotency-Key": "weight-save-replay-1"}
        payload = {
            "loggedOn": "2026-07-08",
            "weightGrams": 80000,
            "notes": "Morning weigh-in.",
        }

        created = client.post("/api/v1/weight", json=payload, headers=headers)
        replayed = client.post("/api/v1/weight", json=payload, headers=headers)
        changed = client.post(
            "/api/v1/weight",
            json={**payload, "weightGrams": 79500},
            headers=headers,
        )

        assert created.status_code == 201
        assert replayed.status_code == 201
        assert replayed.json() == created.json()
        assert changed.status_code == 409
        assert "different request" in changed.json()["error"]["message"]

        with testing_session_local() as db:
            records = list(db.scalars(select(IdempotencyRecord)).all())
            assert len(records) == 1
            assert records[0].operation == "weight.upsert"
            assert records[0].status == "completed"
    finally:
        app.dependency_overrides.clear()
