from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import func, select
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.food import CustomFood
from app.models.meal import Meal, MealImage
from app.models.recipe import Recipe, RecipeItem
from app.models.user import AuditLog, AuthSession, HydrationEntry, NutritionGoal, User, WeightEntry
from app.storage import build_private_image_storage
import app.models as _models  # noqa: F401


def test_export_returns_only_current_user_data() -> None:
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
        first_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "export-a@example.com",
                "password": "local-password-123",
                "displayName": "Export A",
            },
        )
        second_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "export-b@example.com",
                "password": "local-password-123",
                "displayName": "Export B",
            },
        )
        first_headers = {"Authorization": f"Bearer {first_session.json()['token']}"}
        second_headers = {"Authorization": f"Bearer {second_session.json()['token']}"}

        first_goal = client.put(
            "/api/v1/goals",
            headers=first_headers,
            json={
                "startsOn": "2026-07-08",
                "caloriesKcal": 2300,
                "proteinGrams": 160,
                "carbohydrateGrams": 250,
                "fatGrams": 70,
            },
        )
        assert first_goal.status_code == 200

        second_goal = client.put(
            "/api/v1/goals",
            headers=second_headers,
            json={
                "startsOn": "2026-07-08",
                "caloriesKcal": 1800,
                "proteinGrams": 120,
                "carbohydrateGrams": 180,
                "fatGrams": 55,
            },
        )
        assert second_goal.status_code == 200

        first_weight = client.post(
            "/api/v1/weight",
            headers=first_headers,
            json={"loggedOn": "2026-07-08", "weightGrams": 80000},
        )
        assert first_weight.status_code == 201
        assert client.put(
            "/api/v1/hydration/2026-07-08",
            headers=first_headers,
            json={"milliliters": 1200},
        ).status_code == 200

        second_weight = client.post(
            "/api/v1/weight",
            headers=second_headers,
            json={"loggedOn": "2026-07-08", "weightGrams": 70000},
        )
        assert second_weight.status_code == 201
        assert client.put(
            "/api/v1/hydration/2026-07-08",
            headers=second_headers,
            json={"milliliters": 800},
        ).status_code == 200

        first_meal = client.post(
            "/api/v1/meals",
            headers=first_headers,
            json=meal_payload("First user banana", "usda:banana-a"),
        )
        assert first_meal.status_code == 201

        second_meal = client.post(
            "/api/v1/meals",
            headers=second_headers,
            json=meal_payload("Second user rice", "usda:rice-b"),
        )
        assert second_meal.status_code == 201

        first_recipe = client.post(
            "/api/v1/recipes",
            headers=first_headers,
            json={
                "name": "First user recipe",
                "items": meal_payload("First user banana", "usda:banana-a")["items"],
            },
        )
        assert first_recipe.status_code == 201

        second_recipe = client.post(
            "/api/v1/recipes",
            headers=second_headers,
            json={
                "name": "Second user recipe",
                "items": meal_payload("Second user rice", "usda:rice-b")["items"],
            },
        )
        assert second_recipe.status_code == 201

        exported = client.get("/api/v1/export", headers=first_headers)
        assert exported.status_code == 200
        body = exported.json()

        assert body["formatVersion"] == "living-nutrition-export/v1"
        assert body["user"]["email"] == "export-a@example.com"
        assert body["user"]["token"] is None
        assert body["preferences"]["unitSystem"] == "metric"
        assert [goal["caloriesKcal"] for goal in body["goals"]] == [2300]
        assert [entry["weightGrams"] for entry in body["weightEntries"]] == [80000]
        assert [entry["milliliters"] for entry in body["hydrationEntries"]] == [1200]
        assert [meal["name"] for meal in body["meals"]] == ["First user banana"]
        assert [recipe["name"] for recipe in body["recipes"]] == ["First user recipe"]
        assert body["recentFoods"][0]["id"] == "usda:banana-a"
        assert all(meal["name"] != "Second user rice" for meal in body["meals"])

        with TestingSessionLocal() as db:
            export_audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.user_id == first_session.json()["id"],
                    AuditLog.event_type == "user_data.export",
                )
            )
            assert export_audit is not None
            assert export_audit.request_id
            assert export_audit.client_fingerprint
    finally:
        app.dependency_overrides.clear()


def test_delete_account_removes_current_user_owned_data_only() -> None:
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
        first_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "delete-a@example.com",
                "password": "local-password-123",
                "displayName": "Delete A",
            },
        )
        second_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "delete-b@example.com",
                "password": "local-password-123",
                "displayName": "Delete B",
            },
        )
        first_headers = {"Authorization": f"Bearer {first_session.json()['token']}"}
        second_headers = {"Authorization": f"Bearer {second_session.json()['token']}"}

        assert client.put(
            "/api/v1/goals",
            headers=first_headers,
            json={
                "startsOn": "2026-07-08",
                "caloriesKcal": 2300,
                "proteinGrams": 160,
                "carbohydrateGrams": 250,
                "fatGrams": 70,
            },
        ).status_code == 200
        assert client.post(
            "/api/v1/weight",
            headers=first_headers,
            json={"loggedOn": "2026-07-08", "weightGrams": 80000},
        ).status_code == 201
        assert client.put(
            "/api/v1/hydration/2026-07-08",
            headers=first_headers,
            json={"milliliters": 1200},
        ).status_code == 200
        assert client.post(
            "/api/v1/meals",
            headers=first_headers,
            json=meal_payload("Deleted user meal", "usda:deleted"),
        ).status_code == 201
        assert client.post(
            "/api/v1/foods/custom",
            headers=first_headers,
            json={
                "displayName": "Deleted custom food",
                "servingSize": 100,
                "servingSizeUnit": "g",
                "nutrientsPer100g": {
                    "caloriesKcal": 100,
                    "proteinGrams": 10,
                    "carbohydrateGrams": 12,
                    "fatGrams": 3,
                },
            },
        ).status_code == 201
        assert client.post(
            "/api/v1/recipes",
            headers=first_headers,
            json={
                "name": "Deleted user recipe",
                "items": meal_payload("Deleted recipe food", "usda:recipe-deleted")["items"],
            },
        ).status_code == 201

        assert client.put(
            "/api/v1/goals",
            headers=second_headers,
            json={
                "startsOn": "2026-07-08",
                "caloriesKcal": 1800,
                "proteinGrams": 120,
                "carbohydrateGrams": 180,
                "fatGrams": 55,
            },
        ).status_code == 200
        assert client.put(
            "/api/v1/hydration/2026-07-08",
            headers=second_headers,
            json={"milliliters": 800},
        ).status_code == 200
        assert client.post(
            "/api/v1/meals",
            headers=second_headers,
            json=meal_payload("Surviving user meal", "usda:survives"),
        ).status_code == 201
        assert client.post(
            "/api/v1/recipes",
            headers=second_headers,
            json={
                "name": "Surviving user recipe",
                "items": meal_payload("Surviving recipe food", "usda:recipe-survives")["items"],
            },
        ).status_code == 201

        with TestingSessionLocal() as db:
            first_user_audit_ids = list(
                db.scalars(select(AuditLog.id).where(AuditLog.user_id == first_session.json()["id"])).all()
            )
            assert first_user_audit_ids

        deleted = client.delete("/api/v1/account", headers=first_headers)
        assert deleted.status_code == 204

        with TestingSessionLocal() as db:
            assert db.get(User, first_session.json()["id"]) is None
            assert db.get(User, second_session.json()["id"]) is not None
            assert db.scalar(select(func.count()).select_from(Meal).where(Meal.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(Recipe).where(Recipe.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(RecipeItem)) == 1
            assert db.scalar(select(func.count()).select_from(NutritionGoal).where(NutritionGoal.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(WeightEntry).where(WeightEntry.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(HydrationEntry).where(HydrationEntry.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(CustomFood).where(CustomFood.user_id == first_session.json()["id"])) == 0
            assert db.scalar(select(func.count()).select_from(AuthSession).where(AuthSession.user_id == first_session.json()["id"])) == 0
            deleted_user_audits = db.scalars(select(AuditLog).where(AuditLog.id.in_(first_user_audit_ids))).all()
            assert deleted_user_audits
            assert all(entry.user_id is None for entry in deleted_user_audits)
            deletion_audit = db.scalar(
                select(AuditLog).where(AuditLog.event_type == "user_data.account_delete")
            )
            assert deletion_audit is not None
            assert deletion_audit.user_id is None
            assert db.scalar(select(func.count()).select_from(Meal).where(Meal.user_id == second_session.json()["id"])) == 1
            assert db.scalar(select(func.count()).select_from(Recipe).where(Recipe.user_id == second_session.json()["id"])) == 1
            assert db.scalar(select(func.count()).select_from(NutritionGoal).where(NutritionGoal.user_id == second_session.json()["id"])) == 1
            assert db.scalar(select(func.count()).select_from(HydrationEntry).where(HydrationEntry.user_id == second_session.json()["id"])) == 1
    finally:
        app.dependency_overrides.clear()


def test_account_deletion_attempts_every_private_image_before_reporting_cleanup_failure() -> None:
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

    storage = SelectiveFailingStorage(failed_key="meal-images/fail.jpg")
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[build_private_image_storage] = lambda: storage

    try:
        client = TestClient(app)
        session_response = client.post(
            "/api/v1/auth/register",
            json={
                "email": "delete-images@example.com",
                "password": "local-password-123",
                "displayName": "Delete Images",
            },
        )
        assert session_response.status_code == 200
        user_id = session_response.json()["id"]
        headers = {"Authorization": f"Bearer {session_response.json()['token']}"}
        meal_response = client.post(
            "/api/v1/meals",
            headers=headers,
            json=meal_payload("Meal with retained images", "usda:image-cleanup"),
        )
        assert meal_response.status_code == 201

        with TestingSessionLocal() as db:
            db.add_all(
                [
                    MealImage(
                        meal_id=meal_response.json()["id"],
                        storage_key="meal-images/fail.jpg",
                    ),
                    MealImage(
                        meal_id=meal_response.json()["id"],
                        storage_key="meal-images/succeed.jpg",
                    ),
                ]
            )
            db.commit()

        deleted = client.delete("/api/v1/account", headers=headers)
        assert deleted.status_code == 503
        assert deleted.json()["error"]["code"] == "http_error"
        assert storage.attempted_keys == ["meal-images/fail.jpg", "meal-images/succeed.jpg"]

        with TestingSessionLocal() as db:
            assert db.get(User, user_id) is not None
            images = db.scalars(select(MealImage).order_by(MealImage.storage_key.asc())).all()
            assert images[0].storage_key == "meal-images/fail.jpg"
            assert images[0].deleted_at is None
            assert images[0].deletion_attempts == 1
            assert images[0].deletion_error_code == "storage_delete_failed"
            assert images[1].storage_key == "meal-images/succeed.jpg"
            assert images[1].deleted_at is not None
            cleanup_failed_audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.user_id == user_id,
                    AuditLog.event_type == "user_data.account_delete",
                    AuditLog.outcome == "cleanup_failed",
                )
            )
            assert cleanup_failed_audit is not None
            assert cleanup_failed_audit.request_id
            assert cleanup_failed_audit.client_fingerprint
    finally:
        app.dependency_overrides.clear()


def meal_payload(name: str, food_id: str) -> dict:
    return {
        "name": name,
        "loggedAt": "2026-07-08T12:00:00Z",
        "items": [
            {
                "foodId": food_id,
                "displayName": name,
                "consumedGrams": 100,
                "servingQuantity": 100,
                "servingUnit": "grams",
                "calories": 100,
                "proteinGrams": 1,
                "carbohydrateGrams": 20,
                "fatGrams": 1,
                "sourceProvider": "usda",
                "sourceExternalId": food_id.removeprefix("usda:"),
                "sourceVersion": "Foundation",
                "sourceReference": "https://fdc.nal.usda.gov/",
                "nutrientSnapshotJson": {
                    "nutrientsPer100g": {
                        "caloriesKcal": 100,
                        "proteinGrams": 1,
                        "carbohydrateGrams": 20,
                        "fatGrams": 1,
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


class SelectiveFailingStorage:
    def __init__(self, *, failed_key: str) -> None:
        self.failed_key = failed_key
        self.attempted_keys: list[str] = []

    def delete(self, key: str) -> None:
        self.attempted_keys.append(key)
        if key == self.failed_key:
            raise RuntimeError("storage unavailable")
