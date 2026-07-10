from collections.abc import Generator
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.food_routes import get_provider_registry
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.analysis import DataCorrectionReport
from app.models.food import FoodSourceRecord
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResponse, FoodSearchResult, ProviderName
import app.models as _models  # noqa: F401


def test_get_food_detail_returns_stored_record_and_provider_id_lookup() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        record = FoodSourceRecord(
            provider="usda",
            external_id="173944",
            display_name="Bananas, raw",
            data_type="Foundation",
            brand_owner=None,
            nutrients_per_100g={
                "caloriesKcal": 89,
                "proteinGrams": 1.1,
                "carbohydrateGrams": 22.8,
                "fatGrams": 0.3,
                "fiberGrams": 2.6,
                "sugarGrams": 12.2,
                "sodiumMilligrams": 1,
            },
            serving_size=118,
            serving_size_unit="g",
            household_serving_text="1 medium banana",
            original_nutrient_ids={"energy": "1008", "protein": "1003"},
            quality_flags=[],
            source_reference="https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
            retrieved_at=datetime.now(timezone.utc),
        )
        db.add(record)
        db.commit()
        record_id = record.id

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)

    try:
        client = TestClient(app)
        by_record_id = client.get(f"/api/v1/foods/{record_id}")
        assert by_record_id.status_code == 200
        body = by_record_id.json()
        assert body["displayName"] == "Bananas, raw"
        assert body["provider"] == "usda"
        assert body["servingOptions"][1]["label"] == "1 medium banana"
        assert body["servingOptions"][1]["grams"] == 118
        assert body["originalNutrientIds"]["energy"] == "1008"
        assert body["provenanceSummary"]

        by_provider_id = client.get("/api/v1/foods/usda:173944")
        assert by_provider_id.status_code == 200
        assert by_provider_id.json()["externalId"] == "173944"
    finally:
        app.dependency_overrides.clear()


def test_get_food_detail_flags_stale_cached_provider_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        record = FoodSourceRecord(
            provider="open_food_facts",
            external_id="stale-123",
            display_name="Old cached product",
            data_type="packaged_food",
            brand_owner="Old Brand",
            nutrients_per_100g={
                "caloriesKcal": 120,
                "proteinGrams": 5,
                "carbohydrateGrams": 20,
                "fatGrams": 3,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="https://world.openfoodfacts.org/product/stale-123",
            retrieved_at=datetime.now(timezone.utc) - timedelta(days=240),
        )
        db.add(record)
        db.commit()

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: EmptyProviderRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/open_food_facts:stale-123")
        assert response.status_code == 200
        assert "stale_source_record" in response.json()["qualityFlags"]
    finally:
        app.dependency_overrides.clear()


def test_get_food_detail_refreshes_stale_cached_provider_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = RefreshingStaleRegistry()

    with TestingSessionLocal() as db:
        record = FoodSourceRecord(
            provider="open_food_facts",
            external_id="refresh-123",
            display_name="Old protein drink",
            data_type="packaged_food",
            brand_owner="Old Brand",
            nutrients_per_100g={
                "caloriesKcal": 90,
                "proteinGrams": 5,
                "carbohydrateGrams": 12,
                "fatGrams": 2,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="https://world.openfoodfacts.org/product/refresh-123",
            retrieved_at=datetime.now(timezone.utc) - timedelta(days=240),
        )
        db.add(record)
        db.commit()

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/open_food_facts:refresh-123")
        assert response.status_code == 200
        body = response.json()
        assert body["displayName"] == "Fresh protein drink"
        assert body["nutrientsPer100g"]["caloriesKcal"] == 110
        assert "stale_source_record" not in body["qualityFlags"]
        assert registry.detail_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_get_food_detail_delegates_to_provider_when_record_is_not_stored() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingDetailRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/usda:999")
        assert response.status_code == 200
        body = response.json()
        assert body["displayName"] == "Provider delegated apple"
        assert body["sourceReference"] == "https://fdc.nal.usda.gov/fdc-app.html#/food-details/999/nutrients"
        assert body["servingOptions"][0]["grams"] == 100
        assert registry.detail_calls == 1

        registry.result = None
        cached_response = client.get("/api/v1/foods/usda:999")
        assert cached_response.status_code == 200
        assert cached_response.json()["displayName"] == "Provider delegated apple"
        assert registry.detail_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_get_food_detail_returns_error_envelope_for_missing_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: EmptyProviderRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/usda:missing")
        assert response.status_code == 404
        body = response.json()
        assert body["error"]["message"] == "Food record not found."
        assert body["error"]["requestId"]
    finally:
        app.dependency_overrides.clear()


def test_custom_food_detail_includes_user_provider_serving_options_and_provenance() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "cook@example.com",
                "password": "local-password-123",
                "displayName": "Cook",
            },
        )
        token = session.json()["token"]

        created = client.post(
            "/api/v1/foods/custom",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "displayName": "House yogurt bowl",
                "brandOwner": "Home",
                "servingSize": 250,
                "servingSizeUnit": "g",
                "householdServingText": "1 bowl",
                "nutrientsPer100g": {
                    "caloriesKcal": 120,
                    "proteinGrams": 8,
                    "carbohydrateGrams": 12,
                    "fatGrams": 4,
                    "fiberGrams": 1,
                    "sugarGrams": 8,
                    "sodiumMilligrams": 55,
                },
                "notes": "User verified from package and scale.",
            },
        )
        assert created.status_code == 201
        body = created.json()
        assert body["provider"] == "user"
        assert body["recordConfidence"] == "verified"
        assert body["sourceReference"] == "user-created"
        assert body["servingOptions"][1]["label"] == "1 bowl"
        assert body["servingOptions"][1]["grams"] == 250
        assert "custom_food" in body["provenanceSummary"]
    finally:
        app.dependency_overrides.clear()


def test_custom_foods_can_be_listed_and_updated() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "editor@example.com",
                "password": "local-password-123",
                "displayName": "Custom Editor",
            },
        )
        token = session.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        created = client.post(
            "/api/v1/foods/custom",
            headers=headers,
            json=custom_food_payload(display_name="Protein oats", calories=180, protein=12),
        )
        assert created.status_code == 201
        food_id = created.json()["id"]

        listed = client.get("/api/v1/foods/custom", headers=headers)
        assert listed.status_code == 200
        assert listed.json()["items"][0]["displayName"] == "Protein oats"

        updated = client.patch(
            f"/api/v1/foods/custom/{food_id}",
            headers=headers,
            json=custom_food_payload(display_name="Protein oats corrected", calories=165, protein=15),
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["displayName"] == "Protein oats corrected"
        assert body["nutrientsPer100g"]["caloriesKcal"] == 165
        assert body["nutrientsPer100g"]["proteinGrams"] == 15

        detail = client.get(f"/api/v1/foods/{food_id}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["displayName"] == "Protein oats corrected"
    finally:
        app.dependency_overrides.clear()


def test_custom_food_with_barcode_is_returned_by_barcode_lookup() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: EmptyProviderRegistry()

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "barcode@example.com",
                "password": "local-password-123",
                "displayName": "Barcode User",
            },
        )
        token = session.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        created = client.post(
            "/api/v1/foods/custom",
            headers=headers,
            json={
                **custom_food_payload(display_name="Local protein bar", calories=210, protein=20),
                "barcode": "012345678905",
            },
        )
        assert created.status_code == 201
        assert created.json()["dataType"] == "custom_packaged_food"
        assert created.json()["sourceReference"] == "user-created barcode 012345678905"

        barcode_lookup = client.get("/api/v1/foods/barcode/012345678905", headers=headers)
        assert barcode_lookup.status_code == 200
        items = barcode_lookup.json()["items"]
        assert len(items) == 1
        assert items[0]["displayName"] == "Local protein bar"
        assert items[0]["provider"] == "user"
    finally:
        app.dependency_overrides.clear()


def test_external_barcode_lookup_is_cached_after_success() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingBarcodeRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        first = client.get("/api/v1/foods/barcode/123456789012")
        assert first.status_code == 200
        assert first.json()["items"][0]["displayName"] == "Cached protein drink"
        assert registry.barcode_calls == 1

        registry.result = None
        second = client.get("/api/v1/foods/barcode/123456789012")
        assert second.status_code == 200
        assert second.json()["items"][0]["displayName"] == "Cached protein drink"
        assert registry.barcode_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_search_caches_provider_results_and_falls_back_when_provider_fails() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingSearchRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        first = client.get("/api/v1/foods/search?query=apple")
        assert first.status_code == 200
        assert first.json()["items"][0]["displayName"] == "Provider delegated apple"
        assert registry.search_calls == 1

        registry.should_fail = True
        second = client.get("/api/v1/foods/search?query=apple")
        assert second.status_code == 200
        assert second.json()["items"][0]["displayName"] == "Provider delegated apple"
        assert registry.search_calls == 2
    finally:
        app.dependency_overrides.clear()


def test_search_uses_fresh_exact_cached_result_without_provider_call() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = ExactAppleSearchRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        first = client.get("/api/v1/foods/search?query=apple")
        assert first.status_code == 200
        assert first.json()["items"][0]["displayName"] == "Apple"
        assert registry.search_calls == 1

        registry.should_fail = True
        second = client.get("/api/v1/foods/search?query=apple")
        assert second.status_code == 200
        assert second.json()["items"][0]["displayName"] == "Apple"
        assert registry.search_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_search_refreshes_stale_exact_cached_result_before_using_cache() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(
        FoodSourceRecord(
            provider="usda",
            external_id="stale-apple",
            display_name="Apple",
            data_type="Foundation",
            brand_owner=None,
            nutrients_per_100g={
                "caloriesKcal": 52,
                "proteinGrams": 0.3,
                "carbohydrateGrams": 13.8,
                "fatGrams": 0.2,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="stale-fixture",
            retrieved_at=datetime.now(timezone.utc) - timedelta(days=365),
        )
    )
    db.commit()
    db.close()
    registry = ExactAppleSearchRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/search?query=apple")
        assert response.status_code == 200
        assert response.json()["items"][0]["externalId"] == "exact-apple"
        assert registry.search_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_search_flags_duplicate_records_with_substantial_nutrition_conflicts() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: DuplicateConflictSearchRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/search?query=protein%20bar")
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) == 2
        assert all("duplicate_nutrition_conflict" in item["qualityFlags"] for item in items)
    finally:
        app.dependency_overrides.clear()


def test_favorite_foods_can_add_list_and_remove_provider_backed_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: FakeProviderRegistry()

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "favorites@example.com",
                "password": "local-password-123",
                "displayName": "Favorite User",
            },
        )
        token = session.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        added = client.put("/api/v1/foods/favorites/usda:999", headers=headers)
        assert added.status_code == 200
        assert added.json()["displayName"] == "Provider delegated apple"

        favorites = client.get("/api/v1/foods/favorites", headers=headers)
        assert favorites.status_code == 200
        assert len(favorites.json()["items"]) == 1
        assert favorites.json()["items"][0]["id"] == "usda:999"

        removed = client.delete("/api/v1/foods/favorites/usda:999", headers=headers)
        assert removed.status_code == 204

        favorites_after_remove = client.get("/api/v1/foods/favorites", headers=headers)
        assert favorites_after_remove.status_code == 200
        assert favorites_after_remove.json()["items"] == []
    finally:
        app.dependency_overrides.clear()


def test_food_correction_report_can_be_created_for_stored_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        record = FoodSourceRecord(
            provider="usda",
            external_id="stored-123",
            display_name="Stored food",
            data_type="Foundation",
            brand_owner=None,
            nutrients_per_100g={
                "caloriesKcal": 100,
                "proteinGrams": 5,
                "carbohydrateGrams": 15,
                "fatGrams": 2,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="stored-source",
            retrieved_at=datetime.now(timezone.utc),
        )
        db.add(record)
        db.commit()
        food_id = record.id

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "reporter@example.com",
                "password": "local-password-123",
                "displayName": "Reporter",
            },
        )
        token = session.json()["token"]

        response = client.post(
            f"/api/v1/foods/{food_id}/correction-reports",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "reportType": "wrong_nutrients",
                "message": "Calories look too high for this source record.",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "open"
        assert body["reportType"] == "wrong_nutrients"
        assert body["foodSourceRecordId"] == food_id

        with TestingSessionLocal() as db:
            stored_report = db.get(DataCorrectionReport, body["id"])
            assert stored_report is not None
            assert stored_report.message == "Calories look too high for this source record."
    finally:
        app.dependency_overrides.clear()


def test_food_correction_report_resolves_provider_backed_record() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: FakeProviderRegistry()

    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/foods/usda:999/correction-reports",
            json={
                "reportType": "wrong_food_match",
                "message": "This source appears to match a different apple product.",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["status"] == "open"
        assert body["foodSourceRecordId"]

        detail = client.get("/api/v1/foods/usda:999")
        assert detail.status_code == 200
        assert detail.json()["displayName"] == "Provider delegated apple"
    finally:
        app.dependency_overrides.clear()


def test_current_user_correction_reports_are_listed_with_source_metadata() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: FakeProviderRegistry()

    try:
        client = TestClient(app)
        first_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "first-reporter@example.com",
                "password": "local-password-123",
                "displayName": "First Reporter",
            },
        )
        second_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "second-reporter@example.com",
                "password": "local-password-123",
                "displayName": "Second Reporter",
            },
        )
        first_headers = {"Authorization": f"Bearer {first_session.json()['token']}"}
        second_headers = {"Authorization": f"Bearer {second_session.json()['token']}"}

        first_report = client.post(
            "/api/v1/foods/usda:999/correction-reports",
            headers=first_headers,
            json={
                "reportType": "wrong_nutrients",
                "message": "The calories look too low for this provider record.",
            },
        )
        assert first_report.status_code == 201

        second_report = client.post(
            "/api/v1/foods/usda:999/correction-reports",
            headers=second_headers,
            json={
                "reportType": "wrong_food_match",
                "message": "This source looks like a different packaged food.",
            },
        )
        assert second_report.status_code == 201

        listed = client.get("/api/v1/correction-reports", headers=first_headers)
        assert listed.status_code == 200
        body = listed.json()
        assert len(body["items"]) == 1
        assert body["items"][0]["id"] == first_report.json()["id"]
        assert body["items"][0]["sourceDisplayName"] == "Provider delegated apple"
        assert body["items"][0]["sourceProvider"] == "usda"
        assert body["items"][0]["sourceExternalId"] == "999"
        assert body["items"][0]["sourceReference"].endswith("/999/nutrients")
    finally:
        app.dependency_overrides.clear()


def custom_food_payload(display_name: str, calories: float, protein: float) -> dict:
    return {
        "displayName": display_name,
        "brandOwner": "Home",
        "servingSize": 100,
        "servingSizeUnit": "g",
        "householdServingText": "100g",
        "nutrientsPer100g": {
            "caloriesKcal": calories,
            "proteinGrams": protein,
            "carbohydrateGrams": 20,
            "fatGrams": 4,
            "fiberGrams": 3,
            "sugarGrams": 5,
            "sodiumMilligrams": 80,
        },
        "notes": "User verified.",
    }


def create_test_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    return engine, sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_db(TestingSessionLocal: sessionmaker[Session]):
    def _override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    return _override_get_db


class FakeProviderRegistry:
    async def search_foods(self, query: str, locale: str = "en-US") -> FoodSearchResponse:
        return FoodSearchResponse(items=[])

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        if food_id != "usda:999":
            return None

        return FoodSearchResult(
            id="usda:999",
            display_name="Provider delegated apple",
            provider=ProviderName.usda,
            external_id="999",
            data_type="Foundation",
            brand_owner=None,
            nutrients_per_100g=NutrientsPer100g(
                calories_kcal=52,
                protein_grams=0.3,
                carbohydrate_grams=13.8,
                fat_grams=0.2,
                fiber_grams=2.4,
                sugar_grams=10.4,
                sodium_milligrams=1,
            ),
            original_nutrient_ids={"energy": "1008"},
            quality_flags=[],
            record_confidence=ConfidenceTier.high,
            source_reference="https://fdc.nal.usda.gov/fdc-app.html#/food-details/999/nutrients",
            retrieved_at=datetime.now(timezone.utc),
        )

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        return None


class EmptyProviderRegistry(FakeProviderRegistry):
    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        return None


class CountingDetailRegistry(FakeProviderRegistry):
    def __init__(self) -> None:
        self.detail_calls = 0
        self.result: FoodSearchResult | None = provider_delegated_apple()

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        self.detail_calls += 1
        if food_id != "usda:999":
            return None
        return self.result


class CountingSearchRegistry(FakeProviderRegistry):
    def __init__(self) -> None:
        self.search_calls = 0
        self.should_fail = False

    async def search_foods(self, query: str, locale: str = "en-US") -> FoodSearchResponse:
        self.search_calls += 1
        if self.should_fail:
            raise RuntimeError("Provider unavailable")
        return FoodSearchResponse(items=[provider_delegated_apple()])


class ExactAppleSearchRegistry(FakeProviderRegistry):
    def __init__(self) -> None:
        self.search_calls = 0
        self.should_fail = False

    async def search_foods(self, query: str, locale: str = "en-US") -> FoodSearchResponse:
        self.search_calls += 1
        if self.should_fail:
            raise RuntimeError("Provider unavailable")
        return FoodSearchResponse(
            items=[
                FoodSearchResult(
                    id="usda:exact-apple",
                    display_name="Apple",
                    provider=ProviderName.usda,
                    external_id="exact-apple",
                    data_type="Foundation",
                    brand_owner=None,
                    nutrients_per_100g=NutrientsPer100g(
                        calories_kcal=52,
                        protein_grams=0.3,
                        carbohydrate_grams=13.8,
                        fat_grams=0.2,
                        fiber_grams=2.4,
                        sugar_grams=10.4,
                        sodium_milligrams=1,
                    ),
                    original_nutrient_ids={"energy": "1008"},
                    quality_flags=[],
                    record_confidence=ConfidenceTier.high,
                    source_reference="https://fdc.nal.usda.gov/fdc-app.html#/food-details/exact-apple/nutrients",
                    retrieved_at=datetime.now(timezone.utc),
                )
            ]
        )


class CountingBarcodeRegistry(FakeProviderRegistry):
    def __init__(self) -> None:
        self.barcode_calls = 0
        self.result: FoodSearchResult | None = FoodSearchResult(
            id="open_food_facts:123456789012",
            display_name="Cached protein drink",
            provider=ProviderName.open_food_facts,
            external_id="123456789012",
            data_type="packaged_food",
            brand_owner="Local Brand",
            nutrients_per_100g=NutrientsPer100g(
                calories_kcal=90,
                protein_grams=12,
                carbohydrate_grams=6,
                fat_grams=2,
                sodium_milligrams=120,
            ),
            original_nutrient_ids={},
            quality_flags=[],
            record_confidence=ConfidenceTier.medium,
            source_reference="https://world.openfoodfacts.org/product/123456789012",
            retrieved_at=datetime.now(timezone.utc),
        )

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        self.barcode_calls += 1
        return self.result


class RefreshingStaleRegistry(FakeProviderRegistry):
    def __init__(self) -> None:
        self.detail_calls = 0

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        self.detail_calls += 1
        if food_id != "open_food_facts:refresh-123":
            return None

        return FoodSearchResult(
            id="open_food_facts:refresh-123",
            display_name="Fresh protein drink",
            provider=ProviderName.open_food_facts,
            external_id="refresh-123",
            data_type="packaged_food",
            brand_owner="Fresh Brand",
            nutrients_per_100g=NutrientsPer100g(
                calories_kcal=110,
                protein_grams=18,
                carbohydrate_grams=8,
                fat_grams=2,
                sodium_milligrams=80,
            ),
            original_nutrient_ids={},
            quality_flags=[],
            record_confidence=ConfidenceTier.medium,
            source_reference="https://world.openfoodfacts.org/product/refresh-123",
            retrieved_at=datetime.now(timezone.utc),
        )


class DuplicateConflictSearchRegistry(FakeProviderRegistry):
    async def search_foods(self, query: str, locale: str = "en-US") -> FoodSearchResponse:
        return FoodSearchResponse(
            items=[
                FoodSearchResult(
                    id="usda:bar-1",
                    display_name="Protein bar",
                    provider=ProviderName.usda,
                    external_id="bar-1",
                    data_type="Branded",
                    brand_owner="Example",
                    nutrients_per_100g=NutrientsPer100g(
                        calories_kcal=180,
                        protein_grams=20,
                        carbohydrate_grams=20,
                        fat_grams=4,
                    ),
                    original_nutrient_ids={},
                    quality_flags=[],
                    record_confidence=ConfidenceTier.medium,
                    source_reference="usda-fixture",
                    retrieved_at=datetime.now(timezone.utc),
                ),
                FoodSearchResult(
                    id="open_food_facts:bar-2",
                    display_name="Protein bar",
                    provider=ProviderName.open_food_facts,
                    external_id="bar-2",
                    data_type="packaged_food",
                    brand_owner="Example",
                    nutrients_per_100g=NutrientsPer100g(
                        calories_kcal=420,
                        protein_grams=4,
                        carbohydrate_grams=64,
                        fat_grams=18,
                    ),
                    original_nutrient_ids={},
                    quality_flags=[],
                    record_confidence=ConfidenceTier.low,
                    source_reference="off-fixture",
                    retrieved_at=datetime.now(timezone.utc),
                ),
            ]
        )


def provider_delegated_apple() -> FoodSearchResult:
    return FoodSearchResult(
        id="usda:999",
        display_name="Provider delegated apple",
        provider=ProviderName.usda,
        external_id="999",
        data_type="Foundation",
        brand_owner=None,
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=52,
            protein_grams=0.3,
            carbohydrate_grams=13.8,
            fat_grams=0.2,
            fiber_grams=2.4,
            sugar_grams=10.4,
            sodium_milligrams=1,
        ),
        original_nutrient_ids={"energy": "1008"},
        quality_flags=[],
        record_confidence=ConfidenceTier.high,
        source_reference="https://fdc.nal.usda.gov/fdc-app.html#/food-details/999/nutrients",
        retrieved_at=datetime.now(timezone.utc),
    )
