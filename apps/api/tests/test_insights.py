from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
import app.models as _models  # noqa: F401


def test_weekly_insights_returns_goal_line_and_logged_days() -> None:
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
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "insights@example.com",
                "password": "local-password-123",
                "displayName": "Insights",
            },
        )
        token = session.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        goal = client.put(
            "/api/v1/goals",
            headers=headers,
            json={
                "startsOn": "2026-07-01",
                "caloriesKcal": 500,
                "proteinGrams": 100,
                "carbohydrateGrams": 160,
                "fatGrams": 55,
            },
        )
        assert goal.status_code == 200

        assert client.post(
            "/api/v1/meals",
            headers=headers,
            json=meal_payload("Within goal", "2026-07-01T12:00:00Z", 400, 30),
        ).status_code == 201
        assert client.post(
            "/api/v1/meals",
            headers=headers,
            json=meal_payload("Above goal", "2026-07-03T12:00:00Z", 800, 45),
        ).status_code == 201

        response = client.get("/api/v1/insights/weekly?startDate=2026-07-01", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["startDate"] == "2026-07-01"
        assert body["endDate"] == "2026-07-07"
        assert body["calorieTarget"] == 500
        assert body["goalDays"] == 1
        assert body["averageCalories"] == 600
        assert len(body["days"]) == 7
        assert body["days"][0]["date"] == "2026-07-01"
        assert body["days"][0]["goalMet"] is True
        assert body["days"][0]["mealCount"] == 1
        assert body["days"][2]["date"] == "2026-07-03"
        assert body["days"][2]["goalMet"] is False
        assert body["days"][2]["totals"]["calories"] == 800
        assert body["days"][4]["mealCount"] == 0
    finally:
        app.dependency_overrides.clear()


def test_monthly_insights_returns_calendar_month_summary() -> None:
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
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "monthly@example.com",
                "password": "local-password-123",
                "displayName": "Monthly",
            },
        )
        token = session.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        assert client.put(
            "/api/v1/goals",
            headers=headers,
            json={
                "startsOn": "2026-07-01",
                "caloriesKcal": 700,
                "proteinGrams": 110,
                "carbohydrateGrams": 170,
                "fatGrams": 60,
            },
        ).status_code == 200
        assert client.post(
            "/api/v1/meals",
            headers=headers,
            json=meal_payload("Goal day", "2026-07-10T12:00:00Z", 650, 35),
        ).status_code == 201
        assert client.post(
            "/api/v1/meals",
            headers=headers,
            json=meal_payload("Review day", "2026-07-11T12:00:00Z", 900, 40),
        ).status_code == 201

        response = client.get("/api/v1/insights/monthly?month=2026-07", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["month"] == "2026-07"
        assert body["startDate"] == "2026-07-01"
        assert body["endDate"] == "2026-07-31"
        assert body["loggedDays"] == 2
        assert body["goalDays"] == 1
        assert body["averageCalories"] == 775
        assert len(body["days"]) == 31
        assert body["days"][9]["date"] == "2026-07-10"
        assert body["days"][9]["goalMet"] is True
        assert body["days"][10]["date"] == "2026-07-11"
        assert body["days"][10]["goalMet"] is False

        invalid = client.get("/api/v1/insights/monthly?month=July", headers=headers)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["message"] == "month must use YYYY-MM format."
    finally:
        app.dependency_overrides.clear()


def meal_payload(name: str, logged_at: str, calories: float, protein: float) -> dict:
    return {
        "name": name,
        "loggedAt": logged_at,
        "items": [
            {
                "foodId": "usda:fixture",
                "displayName": name,
                "consumedGrams": 100,
                "servingQuantity": 100,
                "servingUnit": "grams",
                "calories": calories,
                "proteinGrams": protein,
                "carbohydrateGrams": 30,
                "fatGrams": 10,
                "fiberGrams": 3,
                "sugarGrams": 4,
                "sodiumMilligrams": 120,
                "sourceProvider": "usda",
                "sourceExternalId": "fixture",
                "sourceVersion": "test",
                "sourceReference": "fixture",
                "nutrientSnapshotJson": {
                    "nutrientsPer100g": {
                        "caloriesKcal": calories,
                        "proteinGrams": protein,
                        "carbohydrateGrams": 30,
                        "fatGrams": 10,
                    }
                },
                "confidence": {
                    "identity": "verified",
                    "portion": "verified",
                    "nutritionRecord": "high",
                    "explanation": "Fixture meal.",
                },
                "userConfirmed": True,
                "addedOilGrams": 0,
            }
        ],
    }
