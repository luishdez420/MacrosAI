from collections.abc import Generator
from datetime import UTC, datetime, timedelta

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models as _models  # noqa: F401
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.analysis import AnalysisJob
from app.models.user import AuditLog, User


def test_one_account_cannot_read_or_mutate_another_accounts_meal_or_recipe() -> None:
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
        owner_headers = register_headers(client, "owner@example.com")
        other_headers = register_headers(client, "other@example.com")

        owner_meal_payload = meal_payload("Owner meal")
        owner_meal_payload["loggedAt"] = "2026-07-20T12:00:00Z"
        meal = client.post("/api/v1/meals", headers=owner_headers, json=owner_meal_payload)
        assert meal.status_code == 201
        meal_id = meal.json()["id"]

        recipe = client.post("/api/v1/recipes", headers=owner_headers, json=recipe_payload())
        assert recipe.status_code == 201
        recipe_id = recipe.json()["id"]

        for method, path, payload in [
            ("get", f"/api/v1/meals/{meal_id}", None),
            ("patch", f"/api/v1/meals/{meal_id}", {"name": "Other account edit"}),
            ("delete", f"/api/v1/meals/{meal_id}", None),
            ("get", f"/api/v1/recipes/{recipe_id}", None),
            ("patch", f"/api/v1/recipes/{recipe_id}", {"name": "Other account edit"}),
            ("delete", f"/api/v1/recipes/{recipe_id}", None),
            ("post", f"/api/v1/recipes/{recipe_id}/log", None),
        ]:
            request_options: dict[str, object] = {"headers": other_headers}
            if payload is not None:
                request_options["json"] = payload
            response = getattr(client, method)(path, **request_options)
            assert response.status_code == 404

        assert client.get("/api/v1/meals", headers=other_headers).json() == []
        assert client.get("/api/v1/recipes", headers=other_headers).json() == []
        assert client.get("/api/v1/diary/2026-07-20", headers=other_headers).json()["meals"] == []
        assert client.get(
            "/api/v1/insights/range?startDate=2026-07-20&endDate=2026-07-20",
            headers=other_headers,
        ).json()["loggedDays"] == 0
        assert client.get(
            "/api/v1/insights/range?startDate=2026-07-20&endDate=2026-07-20",
            headers=owner_headers,
        ).json()["loggedDays"] == 1

        with testing_session() as db:
            denials = db.scalars(
                select(AuditLog).where(
                    AuditLog.user_id.is_not(None),
                    AuditLog.event_type == "authorization.owner_access_denied",
                )
            ).all()
            assert denials
            assert all(event.outcome == "not_found_or_not_owned" for event in denials)
            assert all(event.request_id for event in denials)
            # The audit schema has no resource/payload field, and the
            # persisted values must not expose a guessed meal or recipe ID.
            assert meal_id not in " ".join(
                str(value)
                for event in denials
                for value in (event.event_type, event.outcome, event.request_id, event.client_fingerprint)
            )
            assert recipe_id not in " ".join(
                str(value)
                for event in denials
                for value in (event.event_type, event.outcome, event.request_id, event.client_fingerprint)
            )

        # Date-keyed resources are unique per account, so another user can use
        # the same date without replacing or deleting the owner's measurement.
        assert client.post(
            "/api/v1/weight",
            headers=owner_headers,
            json={"loggedOn": "2026-07-20", "weightGrams": 80000},
        ).status_code == 201
        assert client.post(
            "/api/v1/weight",
            headers=other_headers,
            json={"loggedOn": "2026-07-20", "weightGrams": 70000},
        ).status_code == 201
        assert client.delete("/api/v1/weight/2026-07-20", headers=other_headers).status_code == 204
        owner_weight = client.get("/api/v1/weight", headers=owner_headers)
        assert [entry["weightGrams"] for entry in owner_weight.json()] == [80000]
        assert client.get("/api/v1/weight", headers=other_headers).json() == []

        assert client.get(f"/api/v1/meals/{meal_id}", headers=owner_headers).status_code == 200
        assert client.get(f"/api/v1/recipes/{recipe_id}", headers=owner_headers).status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_owner_scoped_supporting_resources_stay_private_between_accounts() -> None:
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
        owner_headers = register_headers(client, "supporting-owner@example.com")
        other_headers = register_headers(client, "supporting-other@example.com")

        custom_food = client.post(
            "/api/v1/foods/custom",
            headers=owner_headers,
            json=custom_food_payload(),
        )
        assert custom_food.status_code == 201
        custom_food_id = custom_food.json()["id"]

        for method, path, payload in [
            ("get", f"/api/v1/foods/{custom_food_id}", None),
            ("patch", f"/api/v1/foods/custom/{custom_food_id}", custom_food_payload()),
            ("delete", f"/api/v1/foods/custom/{custom_food_id}", None),
        ]:
            request_options: dict[str, object] = {"headers": other_headers}
            if payload is not None:
                request_options["json"] = payload
            response = getattr(client, method)(path, **request_options)
            assert response.status_code == 404

        assert client.get(f"/api/v1/foods/{custom_food_id}", headers=owner_headers).status_code == 200
        assert client.get("/api/v1/foods/custom", headers=other_headers).json()["items"] == []
        assert [item["id"] for item in client.get("/api/v1/foods/custom", headers=owner_headers).json()["items"]] == [
            custom_food_id
        ]

        assert client.put(
            f"/api/v1/foods/favorites/{custom_food_id}",
            headers=owner_headers,
        ).status_code == 200
        assert client.post(
            f"/api/v1/foods/{custom_food_id}/correction-reports",
            headers=owner_headers,
            json={"reportType": "incorrect_nutrition", "message": "Owner review fixture."},
        ).status_code == 201

        # Private custom records cannot be linked to another user's favorites
        # or reports, and the denial takes the same non-enumerating path as
        # detail/edit/delete.
        assert client.put(
            f"/api/v1/foods/favorites/{custom_food_id}",
            headers=other_headers,
        ).status_code == 404
        assert client.post(
            f"/api/v1/foods/{custom_food_id}/correction-reports",
            headers=other_headers,
            json={"reportType": "incorrect_nutrition", "message": "Guessed record."},
        ).status_code == 404

        owner_meal = meal_payload("Owner private custom meal")
        owner_meal["items"] = [
            {
                **meal_item(),
                "foodId": custom_food_id,
                "displayName": "Owner protein bites",
                "sourceProvider": "user",
                "sourceExternalId": custom_food_id.removeprefix("user:"),
                "sourceVersion": "custom_food",
                "sourceReference": "user-created",
            }
        ]
        assert client.post("/api/v1/meals", headers=owner_headers, json=owner_meal).status_code == 201

        assert client.put(
            "/api/v1/goals",
            headers=owner_headers,
            json={
                "caloriesKcal": 2200,
                "proteinGrams": 160,
                "carbohydrateGrams": 240,
                "fatGrams": 70,
            },
        ).status_code == 200
        assert client.put(
            "/api/v1/preferences",
            headers=owner_headers,
            json={"unitSystem": "us", "themePreference": "dark"},
        ).status_code == 200
        assert client.put(
            "/api/v1/hydration/2026-07-20",
            headers=owner_headers,
            json={"milliliters": 1800},
        ).status_code == 200
        assert client.put(
            "/api/v1/hydration/2026-07-20",
            headers=other_headers,
            json={"milliliters": 1200},
        ).status_code == 200

        owner_sessions = client.get("/api/v1/auth/sessions", headers=owner_headers)
        assert owner_sessions.status_code == 200
        owner_session_id = owner_sessions.json()["items"][0]["id"]

        # A guessed session ID must never allow a separate account to revoke it.
        assert client.delete(
            f"/api/v1/auth/sessions/{owner_session_id}",
            headers=other_headers,
        ).status_code == 404
        assert client.get("/api/v1/auth/sessions", headers=owner_headers).status_code == 200

        # Date-keyed resources use harmless no-op deletion, while all reads and
        # upserts remain scoped to the authenticated account.
        assert client.delete(
            "/api/v1/hydration/2026-07-20",
            headers=other_headers,
        ).status_code == 204
        assert client.get(
            "/api/v1/hydration/2026-07-20",
            headers=other_headers,
        ).json() is None
        assert client.get(
            "/api/v1/hydration/2026-07-20",
            headers=owner_headers,
        ).json()["milliliters"] == 1800
        assert client.get(
            "/api/v1/hydration/2026-07-20",
            headers=other_headers,
        ).json() is None

        # A saved-food link belongs to its owner even if the underlying record
        # is globally addressable. A no-op removal must not affect the owner's
        # favorite or recent entry.
        assert client.delete(
            f"/api/v1/foods/favorites/{custom_food_id}",
            headers=other_headers,
        ).status_code == 204
        assert client.delete(
            f"/api/v1/foods/recent/{custom_food_id}",
            headers=other_headers,
        ).status_code == 204
        assert [item["id"] for item in client.get("/api/v1/foods/favorites", headers=owner_headers).json()["items"]] == [
            custom_food_id
        ]
        assert [item["id"] for item in client.get("/api/v1/foods/recent", headers=owner_headers).json()["items"]] == [
            custom_food_id
        ]

        assert client.get("/api/v1/goals", headers=other_headers).json() is None
        assert client.get("/api/v1/goals/history", headers=other_headers).json() == []
        assert client.get("/api/v1/preferences", headers=other_headers).json()["unitSystem"] == "metric"
        assert client.get("/api/v1/foods/favorites", headers=other_headers).json()["items"] == []
        assert client.get("/api/v1/foods/recent", headers=other_headers).json()["items"] == []
        assert client.get("/api/v1/correction-reports", headers=other_headers).json()["items"] == []

        other_export = client.get("/api/v1/export", headers=other_headers)
        assert other_export.status_code == 200
        assert other_export.json()["meals"] == []
        assert other_export.json()["customFoods"] == []
        assert other_export.json()["favoriteFoods"] == []
        assert other_export.json()["recentFoods"] == []
        assert other_export.json()["goals"] == []
        assert other_export.json()["hydrationEntries"] == []

        owner_export = client.get("/api/v1/export", headers=owner_headers)
        assert owner_export.status_code == 200
        assert [meal["name"] for meal in owner_export.json()["meals"]] == ["Owner private custom meal"]
        assert [food["displayName"] for food in owner_export.json()["customFoods"]] == [
            "Owner protein bites"
        ]

        with testing_session() as db:
            denials = db.scalars(
                select(AuditLog).where(
                    AuditLog.user_id.is_not(None),
                    AuditLog.event_type == "authorization.owner_access_denied",
                )
            ).all()
            assert len(denials) >= 5
            assert all(event.outcome == "not_found_or_not_owned" for event in denials)
            assert all(custom_food_id not in " ".join(
                str(value)
                for value in (event.event_type, event.outcome, event.request_id, event.client_fingerprint)
            ) for event in denials)
    finally:
        app.dependency_overrides.clear()


def test_one_account_cannot_confirm_a_meal_from_another_accounts_analysis_job() -> None:
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
        register_headers(client, "analysis-owner@example.com")
        other_headers = register_headers(client, "analysis-other@example.com")

        with testing_session() as db:
            owner = db.scalar(select(User).where(User.email == "analysis-owner@example.com"))
            assert owner is not None
            job = AnalysisJob(
                user_id=owner.id,
                status="needs_review",
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            db.add(job)
            db.commit()
            job_id = job.id

        denied_payload = meal_payload("Cross-account confirmation")
        denied_payload["analysisJobId"] = job_id
        denied = client.post("/api/v1/meals", headers=other_headers, json=denied_payload)
        assert denied.status_code == 404
        assert denied.json()["error"]["message"] == "Meal analysis was not found."
        assert client.get("/api/v1/meals", headers=other_headers).json() == []

        with testing_session() as db:
            job = db.get(AnalysisJob, job_id)
            assert job is not None
            assert job.status == "needs_review"
            other = db.scalar(select(User).where(User.email == "analysis-other@example.com"))
            assert other is not None
            denial = db.scalar(
                select(AuditLog)
                .where(AuditLog.event_type == "authorization.owner_access_denied")
                .order_by(AuditLog.created_at.desc())
            )
            assert denial is not None
            assert denial.user_id == other.id
            assert denial.outcome == "not_found_or_not_owned"
            assert denial.request_id
            assert job_id not in " ".join(
                str(value)
                for value in (
                    denial.event_type,
                    denial.outcome,
                    denial.request_id,
                    denial.client_fingerprint,
                )
            )
    finally:
        app.dependency_overrides.clear()


def test_completed_meal_replay_does_not_require_an_unexpired_analysis_job() -> None:
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
        headers = register_headers(client, "analysis-replay@example.com")

        with testing_session() as db:
            owner = db.scalar(select(User).where(User.email == "analysis-replay@example.com"))
            assert owner is not None
            job = AnalysisJob(
                user_id=owner.id,
                status="needs_review",
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
            db.add(job)
            db.commit()
            job_id = job.id

        payload = meal_payload("Idempotent camera confirmation")
        payload["analysisJobId"] = job_id
        idempotency_headers = {**headers, "Idempotency-Key": "camera-confirmation-replay"}
        created = client.post("/api/v1/meals", headers=idempotency_headers, json=payload)
        assert created.status_code == 201

        with testing_session() as db:
            job = db.get(AnalysisJob, job_id)
            assert job is not None
            job.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            db.commit()

        replayed = client.post("/api/v1/meals", headers=idempotency_headers, json=payload)
        assert replayed.status_code == 201
        assert replayed.json()["id"] == created.json()["id"]
        assert len(client.get("/api/v1/meals", headers=headers).json()) == 1
    finally:
        app.dependency_overrides.clear()


def register_headers(client: TestClient, email: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "correct-horse-battery-staple"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def recipe_payload() -> dict[str, object]:
    return {
        "name": "Owner recipe",
        "mealType": "lunch",
        "items": [meal_item()],
    }


def meal_payload(name: str) -> dict[str, object]:
    return {
        "name": name,
        "mealType": "lunch",
        "items": [meal_item()],
    }


def meal_item() -> dict[str, object]:
    return {
        "foodId": "usda:fixture-1",
        "displayName": "Fixture food",
        "consumedGrams": 100,
        "servingQuantity": 100,
        "servingUnit": "grams",
        "calories": 100,
        "proteinGrams": 10,
        "carbohydrateGrams": 10,
        "fatGrams": 2,
        "sourceProvider": "usda",
        "sourceExternalId": "fixture-1",
        "sourceVersion": "Foundation",
        "sourceReference": "USDA fixture",
        "nutrientSnapshotJson": {"fixture": True},
        "confidence": {
            "identity": "verified",
            "portion": "verified",
            "nutritionRecord": "high",
            "explanation": "Fixture source and confirmed grams.",
        },
        "userConfirmed": True,
        "addedOilGrams": 0,
    }


def custom_food_payload() -> dict[str, object]:
    return {
        "displayName": "Owner protein bites",
        "servingSize": 40,
        "servingSizeUnit": "g",
        "nutrientsPer100g": {
            "caloriesKcal": 380,
            "proteinGrams": 25,
            "carbohydrateGrams": 35,
            "fatGrams": 16,
        },
    }
