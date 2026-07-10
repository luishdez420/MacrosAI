from collections.abc import Generator

from fastapi.testclient import TestClient
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

        created = client.post("/api/v1/meals", json=meal_payload)
        assert created.status_code == 201
        assert created.json()["items"][0]["displayName"] == "Bananas, raw"

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
        assert body["meals"][0]["items"][0]["nutrientSnapshotJson"]["nutrientsPer100g"]["caloriesKcal"] == 89

        updated = client.patch(
            f"/api/v1/meals/{created.json()['id']}",
            json={
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
        assert updated.json()["items"][0]["consumedGrams"] == 59

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
