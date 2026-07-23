from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
import app.models as _models  # noqa: F401


def test_create_meal_and_read_diary_totals() -> None:
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
        meal_payload = {
            "name": "Banana",
            "mealType": "breakfast",
            "loggedAt": "2026-07-06T12:00:00Z",
            "notes": "Manual entry for 1 medium banana.",
            "items": [
                {
                    "foodId": "usda:173944",
                    "displayName": "Bananas, raw",
                    "consumedGrams": 118,
                    "servingQuantity": 118,
                    "servingUnit": "grams",
                    "calories": 105.02,
                    "proteinGrams": 1.298,
                    "carbohydrateGrams": 26.904,
                    "fatGrams": 0.354,
                    "sourceProvider": "usda",
                    "sourceExternalId": "173944",
                    "sourceVersion": "Foundation",
                    "sourceReference": "https://fdc.nal.usda.gov/",
                    "nutrientSnapshotJson": {
                        "nutrientsPer100g": {
                            "caloriesKcal": 89,
                            "proteinGrams": 1.1,
                            "carbohydrateGrams": 22.8,
                            "fatGrams": 0.3,
                        }
                    },
                    "confidence": {
                        "identity": "verified",
                        "portion": "verified",
                        "nutritionRecord": "high",
                        "explanation": "Manual entry from selected source record.",
                    },
                    "userConfirmed": True,
                    "addedOilGrams": 0,
                    "notes": "Manual entry.",
                }
            ],
        }

        created = client.post(
            "/api/v1/meals",
            json=meal_payload,
            headers={"Idempotency-Key": "manual-banana-2026-07-06"},
        )
        assert created.status_code == 201
        assert created.json()["mealType"] == "breakfast"
        assert created.json()["revision"] == 1
        assert created.json()["loggedAt"].startswith("2026-07-06T12:00:00")
        assert created.json()["items"][0]["displayName"] == "Bananas, raw"

        replayed = client.post(
            "/api/v1/meals",
            json=meal_payload,
            headers={"Idempotency-Key": "manual-banana-2026-07-06"},
        )
        assert replayed.status_code == 201
        assert replayed.json()["id"] == created.json()["id"]

        conflicting_replay = client.post(
            "/api/v1/meals",
            json={**meal_payload, "name": "Banana with peanut butter"},
            headers={"Idempotency-Key": "manual-banana-2026-07-06"},
        )
        assert conflicting_replay.status_code == 409
        assert "different request" in conflicting_replay.json()["error"]["message"]

        meals = client.get("/api/v1/meals?date=2026-07-06")
        assert meals.status_code == 200
        assert len(meals.json()) == 1

        recent = client.get("/api/v1/foods/recent")
        assert recent.status_code == 200
        recent_items = recent.json()["items"]
        assert len(recent_items) == 1
        assert recent_items[0]["id"] == "usda:173944"
        assert recent_items[0]["displayName"] == "Bananas, raw"
        assert recent_items[0]["nutrientsPer100g"]["caloriesKcal"] == 89

        diary = client.get("/api/v1/diary/2026-07-06")
        assert diary.status_code == 200
        body = diary.json()
        assert body["totals"]["calories"] == 105.0
        assert body["totals"]["proteinGrams"] == 1.3
        assert body["meals"][0]["mealType"] == "breakfast"
        assert body["meals"][0]["items"][0]["nutrientSnapshotJson"]["nutrientsPer100g"]["caloriesKcal"] == 89

        updated = client.patch(
            f"/api/v1/meals/{created.json()['id']}",
            headers={"If-Match": '"1"'},
            json={
                "mealType": "snack",
                "loggedAt": "2026-07-06T15:30:00Z",
                "items": [
                    {
                        **meal_payload["items"][0],
                        "consumedGrams": 59,
                        "servingQuantity": 59,
                        "calories": 52.51,
                        "proteinGrams": 0.649,
                        "carbohydrateGrams": 13.452,
                        "fatGrams": 0.177,
                        "nutrientSnapshotJson": {
                            **meal_payload["items"][0]["nutrientSnapshotJson"],
                            "consumedGrams": 59,
                        },
                    }
                ]
            },
        )
        assert updated.status_code == 200
        assert updated.json()["revision"] == 2
        assert updated.json()["mealType"] == "snack"
        assert updated.json()["loggedAt"].startswith("2026-07-06T15:30:00")
        assert updated.json()["items"][0]["consumedGrams"] == 59

        stale_update = client.patch(
            f"/api/v1/meals/{created.json()['id']}",
            headers={"If-Match": '"1"'},
            json={"name": "Stale edit"},
        )
        assert stale_update.status_code == 409
        assert "changed on another device" in stale_update.json()["error"]["message"]

        missing_revision = client.patch(
            f"/api/v1/meals/{created.json()['id']}",
            json={"name": "Missing revision"},
        )
        assert missing_revision.status_code == 428

        invalid_revision = client.patch(
            f"/api/v1/meals/{created.json()['id']}",
            headers={"If-Match": "2"},
            json={"name": "Invalid revision"},
        )
        assert invalid_revision.status_code == 400

        current = client.get(f"/api/v1/meals/{created.json()['id']}")
        assert current.status_code == 200
        assert current.json()["name"] == "Banana"
        assert current.json()["revision"] == 2

        recent_after_update = client.get("/api/v1/foods/recent")
        assert recent_after_update.status_code == 200
        assert len(recent_after_update.json()["items"]) == 1

        removed_recent = client.delete("/api/v1/foods/recent/usda:173944")
        assert removed_recent.status_code == 204

        recent_after_remove = client.get("/api/v1/foods/recent")
        assert recent_after_remove.status_code == 200
        assert recent_after_remove.json()["items"] == []

        updated_diary = client.get("/api/v1/diary/2026-07-06")
        assert updated_diary.status_code == 200
        assert updated_diary.json()["totals"]["calories"] == 52.5
    finally:
        app.dependency_overrides.clear()
