from collections.abc import Generator

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
import app.models as _models  # noqa: F401


def test_recipe_can_be_saved_and_logged_as_a_new_meal_snapshot() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        client = TestClient(app)
        create_headers = {"Idempotency-Key": "recipe-create-replay-1"}
        created = client.post("/api/v1/recipes", json=recipe_payload(), headers=create_headers)
        assert created.status_code == 201
        recipe = created.json()
        assert recipe["name"] == "Chicken rice bowl"
        assert recipe["mealType"] == "lunch"
        assert recipe["timesUsed"] == 0
        assert recipe["isFavorite"] is False
        assert len(recipe["items"]) == 2
        assert [item["displayName"] for item in recipe["items"]] == [
            "Chicken breast",
            "Cooked white rice",
        ]

        tagged = client.put(
            f"/api/v1/recipes/{recipe['id']}/tags",
            json={"tags": [" Weekday ", "quick", "weekday"]},
        )
        assert tagged.status_code == 200
        assert tagged.json()["tags"] == ["Weekday", "quick"]

        favorited = client.patch(
            f"/api/v1/recipes/{recipe['id']}",
            json={"isFavorite": True},
        )
        assert favorited.status_code == 200
        assert favorited.json()["isFavorite"] is True

        invalid_favorite = client.patch(
            f"/api/v1/recipes/{recipe['id']}",
            json={"isFavorite": None},
        )
        assert invalid_favorite.status_code == 422

        replayed_create = client.post("/api/v1/recipes", json=recipe_payload(), headers=create_headers)
        assert replayed_create.status_code == 201
        assert replayed_create.json()["id"] == recipe["id"]

        conflicting_create = client.post(
            "/api/v1/recipes",
            json={**recipe_payload(), "name": "Different recipe"},
            headers=create_headers,
        )
        assert conflicting_create.status_code == 409

        listed = client.get("/api/v1/recipes")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [recipe["id"]]
        assert listed.json()[0]["tags"] == ["Weekday", "quick"]

        log_headers = {"Idempotency-Key": "recipe-log-replay-1"}
        logged = client.post(f"/api/v1/recipes/{recipe['id']}/log", headers=log_headers)
        assert logged.status_code == 201
        logged_body = logged.json()
        assert logged_body["recipe"]["timesUsed"] == 1
        assert logged_body["meal"]["name"] == "Chicken rice bowl"
        assert logged_body["meal"]["mealType"] == "lunch"
        assert [item["displayName"] for item in logged_body["meal"]["items"]] == [
            "Chicken breast",
            "Cooked white rice",
        ]
        assert logged_body["meal"]["items"][0]["nutrientSnapshotJson"] == recipe["items"][0]["nutrientSnapshotJson"]

        replayed_log = client.post(f"/api/v1/recipes/{recipe['id']}/log", headers=log_headers)
        assert replayed_log.status_code == 201
        assert replayed_log.json()["meal"]["id"] == logged_body["meal"]["id"]
        assert replayed_log.json()["recipe"]["timesUsed"] == 1

        updated = client.patch(
            f"/api/v1/recipes/{recipe['id']}",
            json={
                "name": "Chicken bowl, lighter rice",
                "mealType": "dinner",
                "notes": "Future lunches only",
                "items": [recipe_payload()["items"][0]],
            },
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Chicken bowl, lighter rice"
        assert updated.json()["mealType"] == "dinner"
        assert len(updated.json()["items"]) == 1

        logged_updated = client.post(f"/api/v1/recipes/{recipe['id']}/log")
        assert logged_updated.status_code == 201
        assert logged_updated.json()["recipe"]["timesUsed"] == 2
        assert logged_updated.json()["meal"]["name"] == "Chicken bowl, lighter rice"
        assert logged_updated.json()["meal"]["mealType"] == "dinner"
        assert len(logged_updated.json()["meal"]["items"]) == 1
        assert len(logged_body["meal"]["items"]) == 2

        logged_date = logged_body["meal"]["loggedAt"].split("T")[0]
        diary = client.get(f"/api/v1/diary/{logged_date}")
        assert diary.status_code == 200
        assert {meal["name"] for meal in diary.json()["meals"]} == {
            "Chicken rice bowl",
            "Chicken bowl, lighter rice",
        }
    finally:
        app.dependency_overrides.clear()


def test_recipe_tags_are_owner_scoped() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        owner = client.post("/api/v1/auth/register", json={"email": "recipe-owner@example.com", "password": "local-password-123"})
        other = client.post("/api/v1/auth/register", json={"email": "recipe-other@example.com", "password": "local-password-123"})
        owner_headers = {"Authorization": f"Bearer {owner.json()['accessToken']}"}
        other_headers = {"Authorization": f"Bearer {other.json()['accessToken']}"}
        recipe = client.post("/api/v1/recipes", json=recipe_payload(), headers=owner_headers).json()

        tagged = client.put(
            f"/api/v1/recipes/{recipe['id']}/tags",
            json={"tags": ["Weekday"]},
            headers=owner_headers,
        )
        assert tagged.status_code == 200
        assert tagged.json()["tags"] == ["Weekday"]
        assert client.put(
            f"/api/v1/recipes/{recipe['id']}/tags",
            json={"tags": ["Other account"]},
            headers=other_headers,
        ).status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_recipe_folders_are_private_and_unfile_recipes_without_changing_snapshots() -> None:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        owner = client.post("/api/v1/auth/register", json={"email": "folder-owner@example.com", "password": "local-password-123"})
        other = client.post("/api/v1/auth/register", json={"email": "folder-other@example.com", "password": "local-password-123"})
        owner_headers = {"Authorization": f"Bearer {owner.json()['accessToken']}"}
        other_headers = {"Authorization": f"Bearer {other.json()['accessToken']}"}

        created_folder = client.post("/api/v1/recipes/folders", json={"name": " Weeknight dinners "}, headers=owner_headers)
        assert created_folder.status_code == 201
        folder = created_folder.json()
        assert folder["name"] == "Weeknight dinners"
        assert client.post(
            "/api/v1/recipes/folders",
            json={"name": "weeknight dinners"},
            headers=owner_headers,
        ).status_code == 409

        recipe = client.post(
            "/api/v1/recipes",
            json={**recipe_payload(), "folderId": folder["id"]},
            headers=owner_headers,
        )
        assert recipe.status_code == 201
        assert recipe.json()["folderId"] == folder["id"]
        assert recipe.json()["folderName"] == "Weeknight dinners"
        original_snapshot = recipe.json()["items"][0]["nutrientSnapshotJson"]

        renamed = client.patch(
            f"/api/v1/recipes/folders/{folder['id']}",
            json={"name": "Weekday dinners"},
            headers=owner_headers,
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Weekday dinners"

        assert client.get("/api/v1/recipes/folders", headers=other_headers).json() == []
        assert client.patch(
            f"/api/v1/recipes/folders/{folder['id']}",
            json={"name": "Other account"},
            headers=other_headers,
        ).status_code == 404
        assert client.patch(
            f"/api/v1/recipes/{recipe.json()['id']}",
            json={"folderId": folder["id"]},
            headers=other_headers,
        ).status_code == 404
        assert client.patch(
            f"/api/v1/recipes/{recipe.json()['id']}",
            json={"isFavorite": True},
            headers=other_headers,
        ).status_code == 404
        assert client.delete(
            f"/api/v1/recipes/folders/{folder['id']}",
            headers=other_headers,
        ).status_code == 404

        deleted = client.delete(f"/api/v1/recipes/folders/{folder['id']}", headers=owner_headers)
        assert deleted.status_code == 204
        persisted = client.get(f"/api/v1/recipes/{recipe.json()['id']}", headers=owner_headers)
        assert persisted.status_code == 200
        assert persisted.json()["folderId"] is None
        assert persisted.json()["folderName"] is None
        assert persisted.json()["items"][0]["nutrientSnapshotJson"] == original_snapshot
    finally:
        app.dependency_overrides.clear()


def recipe_payload() -> dict[str, object]:
    return {
        "name": "Chicken rice bowl",
        "mealType": "lunch",
        "notes": "Weekday lunch",
        "items": [
            meal_item("usda:chicken", "Chicken breast", 150, 247.5, 46.5, 0, 5.4),
            meal_item("usda:rice", "Cooked white rice", 200, 260, 5.4, 56, 0.6),
        ],
    }


def meal_item(
    food_id: str,
    name: str,
    grams: float,
    calories: float,
    protein: float,
    carbs: float,
    fat: float,
) -> dict[str, object]:
    return {
        "foodId": food_id,
        "displayName": name,
        "consumedGrams": grams,
        "servingQuantity": grams,
        "servingUnit": "grams",
        "calories": calories,
        "proteinGrams": protein,
        "carbohydrateGrams": carbs,
        "fatGrams": fat,
        "sourceProvider": "usda",
        "sourceExternalId": food_id.removeprefix("usda:"),
        "sourceVersion": "Foundation",
        "sourceReference": "USDA fixture",
        "nutrientSnapshotJson": {"source": "fixture", "foodId": food_id},
        "confidence": {
            "identity": "verified",
            "portion": "verified",
            "nutritionRecord": "high",
            "explanation": "Selected nutrition source and entered grams.",
        },
        "userConfirmed": True,
        "addedOilGrams": 0,
    }
