from collections.abc import Generator
from datetime import datetime, timedelta, timezone

from tests.http_client import ApiTestClient as TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.food_routes import (
    cache_food_result,
    get_provider_registry,
    persist_duplicate_nutrition_conflicts,
    refresh_retry_delay_seconds,
)
from app.core.metrics import metrics
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.analysis import DataCorrectionReport
from app.models.food import FoodSearchCache, FoodSourceConflict, FoodSourceRecord, FoodSourceRevision
from app.models.idempotency import IdempotencyRecord
from app.nutrition.provider import NutritionProviderUnavailableError
from app.nutrition.provider_registry import NutritionProviderRegistry
from app.nutrition.providers.e2e_fixture import (
    E2EFixtureNutritionProvider,
    E2E_PROVIDER_OUTAGE_QUERY,
    E2E_RATE_LIMIT_QUERY,
)
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
        assert body["qualityAssessment"] == {
            "status": "complete",
            "signals": ["provider_record"],
            "summary": "The normalized provider record passed the app's basic completeness checks. Confirm the portion you ate.",
            "isBlocking": False,
        }

        by_provider_id = client.get("/api/v1/foods/usda:173944")
        assert by_provider_id.status_code == 200
        assert by_provider_id.json()["externalId"] == "173944"
    finally:
        app.dependency_overrides.clear()


def test_search_maps_fixture_provider_outage_to_a_correlated_service_unavailable_response() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: NutritionProviderRegistry(
        [E2EFixtureNutritionProvider()]
    )

    try:
        client = TestClient(app)
        response = client.get(
            "/api/v1/foods/search",
            params={"query": E2E_PROVIDER_OUTAGE_QUERY},
        )

        assert response.status_code == 503
        assert response.headers["x-request-id"]
        assert response.json()["error"] == {
            "message": "Nutrition records are temporarily unavailable. Please try again shortly.",
            "code": "nutrition_provider_unavailable",
            "requestId": response.headers["x-request-id"],
        }
    finally:
        app.dependency_overrides.clear()


def test_search_exposes_fixture_rate_limit_with_the_normal_error_envelope(monkeypatch) -> None:
    monkeypatch.setattr(settings, "e2e_fixture_mode", True)
    client = TestClient(app)

    response = client.get("/api/v1/foods/search", params={"query": E2E_RATE_LIMIT_QUERY})

    assert response.status_code == 429
    assert response.headers["retry-after"] == "1"
    request_id = response.headers["x-request-id"]
    assert response.json() == {
        "error": {
            "message": "Too many requests. Please wait and try again.",
            "code": "rate_limited",
            "requestId": request_id,
        }
    }


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


def test_food_detail_preserves_only_changed_provider_source_revisions() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    first_retrieval = datetime(2026, 7, 1, tzinfo=timezone.utc)
    updated_retrieval = datetime(2026, 7, 10, tzinfo=timezone.utc)

    with TestingSessionLocal() as db:
        initial = barcode_result("Protein drink", 90).model_copy(
            update={"retrieved_at": first_retrieval}
        )
        unchanged = initial.model_copy(update={"retrieved_at": updated_retrieval})
        changed = barcode_result("Protein drink", 110).model_copy(
            update={"retrieved_at": updated_retrieval}
        )
        source_record = cache_food_result(db, initial)
        cache_food_result(db, unchanged)
        cache_food_result(db, changed)
        db.commit()

        revisions = db.scalars(
            select(FoodSourceRevision)
            .where(FoodSourceRevision.food_source_record_id == source_record.id)
            .order_by(FoodSourceRevision.source_retrieved_at)
        ).all()
        assert [revision.nutrients_per_100g["calories_kcal"] for revision in revisions] == [90, 110]

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: EmptyProviderRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/open_food_facts:123456789012")
        assert response.status_code == 200
        history = response.json()["retrievalHistory"]
        assert len(history) == 2
        assert history[0]["nutrientsPer100g"]["caloriesKcal"] == 110
        assert history[1]["nutrientsPer100g"]["caloriesKcal"] == 90
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

        second_session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "different-editor@example.com",
                "password": "local-password-123",
                "displayName": "Different Editor",
            },
        )
        second_headers = {"Authorization": f"Bearer {second_session.json()['token']}"}
        assert client.get(f"/api/v1/foods/{food_id}", headers=second_headers).status_code == 404
        assert client.delete(f"/api/v1/foods/custom/{food_id}", headers=second_headers).status_code == 404

        deleted = client.delete(f"/api/v1/foods/custom/{food_id}", headers=headers)
        assert deleted.status_code == 204
        assert client.get("/api/v1/foods/custom", headers=headers).json()["items"] == []
    finally:
        app.dependency_overrides.clear()


def test_custom_food_create_replays_exact_request_and_rejects_changed_reuse() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={
                "email": "custom-replay@example.com",
                "password": "local-password-123",
                "displayName": "Custom Replay",
            },
        )
        headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Idempotency-Key": "custom-food-replay-1",
        }
        payload = custom_food_payload(display_name="Replay oatmeal", calories=175, protein=9)

        created = client.post("/api/v1/foods/custom", headers=headers, json=payload)
        replayed = client.post("/api/v1/foods/custom", headers=headers, json=payload)
        conflicting = client.post(
            "/api/v1/foods/custom",
            headers=headers,
            json={**payload, "displayName": "Changed oatmeal"},
        )

        assert created.status_code == 201
        assert replayed.status_code == 201
        assert replayed.json()["id"] == created.json()["id"]
        assert conflicting.status_code == 409

        listed = client.get("/api/v1/foods/custom", headers=headers)
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()["items"]] == [created.json()["id"]]
    finally:
        app.dependency_overrides.clear()


def test_custom_foods_do_not_leak_through_shared_search_or_source_actions() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: EmptyProviderRegistry()

    try:
        client = TestClient(app)
        owner = client.post(
            "/api/v1/auth/register",
            json={
                "email": "private-food-owner@example.com",
                "password": "local-password-123",
            },
        )
        other = client.post(
            "/api/v1/auth/register",
            json={
                "email": "private-food-other@example.com",
                "password": "local-password-123",
            },
        )
        owner_headers = {"Authorization": f"Bearer {owner.json()['token']}"}
        other_headers = {"Authorization": f"Bearer {other.json()['token']}"}

        created = client.post(
            "/api/v1/foods/custom",
            headers=owner_headers,
            json=custom_food_payload(display_name="Private family granola", calories=310, protein=9),
        )
        assert created.status_code == 201
        food_id = created.json()["id"]

        # Public provider search must never return another account's custom
        # record, even when it shares the exact display name.
        search = client.get("/api/v1/foods/search?query=Private%20family%20granola")
        assert search.status_code == 200
        assert search.json()["items"] == []

        assert client.get(f"/api/v1/foods/{food_id}", headers=other_headers).status_code == 404
        assert client.put(f"/api/v1/foods/favorites/{food_id}", headers=other_headers).status_code == 404
        assert client.post(
            f"/api/v1/foods/{food_id}/correction-reports",
            headers=other_headers,
            json={"reportType": "incorrect_nutrition", "message": "Not mine."},
        ).status_code == 404

        assert client.get(f"/api/v1/foods/{food_id}", headers=owner_headers).status_code == 200
        assert client.put(f"/api/v1/foods/favorites/{food_id}", headers=owner_headers).status_code == 200
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


def test_cached_barcode_lookup_keeps_a_current_duplicate_conflict_visible() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        usda_record = FoodSourceRecord(
            provider="usda",
            external_id="protein-bar-1",
            display_name="Protein bar",
            data_type="Branded",
            brand_owner="Example",
            nutrients_per_100g={
                "caloriesKcal": 180,
                "proteinGrams": 20,
                "carbohydrateGrams": 20,
                "fatGrams": 4,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="usda-fixture",
            retrieved_at=datetime.now(timezone.utc),
        )
        open_food_facts_record = FoodSourceRecord(
            provider="open_food_facts",
            external_id="123456789012",
            display_name="Protein bar",
            data_type="packaged_food",
            brand_owner="Example",
            nutrients_per_100g={
                "caloriesKcal": 420,
                "proteinGrams": 4,
                "carbohydrateGrams": 64,
                "fatGrams": 18,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="off-fixture",
            retrieved_at=datetime.now(timezone.utc),
        )
        db.add_all((usda_record, open_food_facts_record))
        db.flush()
        persist_duplicate_nutrition_conflicts([usda_record, open_food_facts_record], db)
        db.commit()

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: CountingBarcodeRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/barcode/123456789012")
        assert response.status_code == 200
        assert response.json()["items"][0]["externalId"] == "123456789012"
        assert "duplicate_nutrition_conflict" in response.json()["items"][0]["qualityFlags"]
    finally:
        app.dependency_overrides.clear()


def test_barcode_provider_outage_returns_safe_error_envelope() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: UnavailableBarcodeRegistry()

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/barcode/123456789012")

        assert response.status_code == 503
        assert response.json()["error"]["code"] == "nutrition_provider_unavailable"
        assert "temporarily unavailable" in response.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


def test_stale_cached_barcode_record_refreshes_before_returning_a_match() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingBarcodeRegistry()
    registry.result = barcode_result("Fresh protein drink", 110)

    with TestingSessionLocal() as db:
        db.add(
            FoodSourceRecord(
                provider="open_food_facts",
                external_id="123456789012",
                display_name="Old protein drink",
                data_type="packaged_food",
                brand_owner="Old Brand",
                nutrients_per_100g={
                    "caloriesKcal": 90,
                    "proteinGrams": 12,
                    "carbohydrateGrams": 6,
                    "fatGrams": 2,
                },
                original_nutrient_ids={},
                quality_flags=[],
                source_reference="https://world.openfoodfacts.org/product/123456789012",
                retrieved_at=datetime.now(timezone.utc) - timedelta(days=240),
            )
        )
        db.commit()

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/barcode/123456789012")
        assert response.status_code == 200
        body = response.json()["items"][0]
        assert body["displayName"] == "Fresh protein drink"
        assert body["nutrientsPer100g"]["caloriesKcal"] == 110
        assert "stale_source_record" not in body["qualityFlags"]
        assert registry.barcode_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_stale_cached_barcode_record_remains_available_when_refresh_has_no_match() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingBarcodeRegistry()
    registry.result = None

    with TestingSessionLocal() as db:
        db.add(
            FoodSourceRecord(
                provider="open_food_facts",
                external_id="123456789012",
                display_name="Old protein drink",
                data_type="packaged_food",
                brand_owner="Old Brand",
                nutrients_per_100g={
                    "caloriesKcal": 90,
                    "proteinGrams": 12,
                    "carbohydrateGrams": 6,
                    "fatGrams": 2,
                },
                original_nutrient_ids={},
                quality_flags=[],
                source_reference="https://world.openfoodfacts.org/product/123456789012",
                retrieved_at=datetime.now(timezone.utc) - timedelta(days=240),
            )
        )
        db.commit()

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        response = client.get("/api/v1/foods/barcode/123456789012")
        assert response.status_code == 200
        body = response.json()["items"][0]
        assert body["displayName"] == "Old protein drink"
        assert "stale_source_record" in body["qualityFlags"]
        assert registry.barcode_calls == 1
    finally:
        app.dependency_overrides.clear()


def test_stale_barcode_refresh_is_deferred_after_a_no_match_and_recovers() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingBarcodeRegistry()
    registry.result = None

    with TestingSessionLocal() as db:
        record = FoodSourceRecord(
            provider="open_food_facts",
            external_id="123456789012",
            display_name="Old protein drink",
            data_type="packaged_food",
            brand_owner="Old Brand",
            nutrients_per_100g={
                "caloriesKcal": 90,
                "proteinGrams": 12,
                "carbohydrateGrams": 6,
                "fatGrams": 2,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="https://world.openfoodfacts.org/product/123456789012",
            retrieved_at=datetime.now(timezone.utc) - timedelta(days=240),
        )
        db.add(record)
        db.commit()
        record_id = record.id

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        first = client.get("/api/v1/foods/barcode/123456789012")
        second = client.get("/api/v1/foods/barcode/123456789012")

        assert first.status_code == 200
        assert second.status_code == 200
        assert registry.barcode_calls == 1
        assert "stale_source_record" in second.json()["items"][0]["qualityFlags"]
        assert 'outcome="refresh_deferred"' in metrics.render_prometheus()

        with TestingSessionLocal() as db:
            persisted = db.get(FoodSourceRecord, record_id)
            assert persisted is not None
            assert persisted.refresh_failure_count == 1
            assert persisted.refresh_attempted_at is not None
            assert persisted.refresh_not_before is not None
            # Simulate the retry window elapsing without waiting in the test.
            persisted.refresh_not_before = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()

        registry.result = barcode_result("Fresh protein drink", 110)
        recovered = client.get("/api/v1/foods/barcode/123456789012")

        assert recovered.status_code == 200
        assert recovered.json()["items"][0]["displayName"] == "Fresh protein drink"
        assert registry.barcode_calls == 2
        with TestingSessionLocal() as db:
            persisted = db.get(FoodSourceRecord, record_id)
            assert persisted is not None
            assert persisted.refresh_failure_count == 0
            assert persisted.refresh_not_before is None
            assert persisted.refresh_attempted_at is None
    finally:
        app.dependency_overrides.clear()


def test_food_source_refresh_retry_delay_is_bounded_and_deterministic(monkeypatch) -> None:
    from app.core.config import settings

    monkeypatch.setattr(settings, "food_source_refresh_retry_base_seconds", 60)
    monkeypatch.setattr(settings, "food_source_refresh_retry_max_seconds", 300)
    monkeypatch.setattr(settings, "food_source_refresh_retry_jitter_ratio", 0.2)

    first = refresh_retry_delay_seconds("record-1", 1)
    repeated_first = refresh_retry_delay_seconds("record-1", 1)
    later = refresh_retry_delay_seconds("record-1", 8)

    assert first == repeated_first
    assert 48 <= first <= 72
    assert 240 <= later <= 360


def test_search_reuses_fresh_partial_query_cache_without_provider_call() -> None:
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
        assert registry.search_calls == 1
        assert (
            'living_nutrition_food_cache_events_total{cache="query_index",operation="search",outcome="fresh_hit"} 1'
            in metrics.render_prometheus()
        )
    finally:
        app.dependency_overrides.clear()


def test_search_refreshes_after_query_cache_expiry() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    registry = CountingSearchRegistry()
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: registry

    try:
        client = TestClient(app)
        first = client.get("/api/v1/foods/search?query=apple")
        assert first.status_code == 200
        assert registry.search_calls == 1

        with TestingSessionLocal() as db:
            cache_entry = db.scalar(
                select(FoodSearchCache).where(
                    FoodSearchCache.normalized_query == "apple",
                    FoodSearchCache.locale == "en-US",
                )
            )
            assert cache_entry is not None
            cache_entry.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            db.commit()

        second = client.get("/api/v1/foods/search?query=apple")
        assert second.status_code == 200
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


def test_duplicate_conflict_history_is_persisted_and_marks_only_current_disagreements() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    app.dependency_overrides[get_provider_registry] = lambda: DuplicateConflictSearchRegistry()

    try:
        client = TestClient(app)
        search = client.get("/api/v1/foods/search?query=protein%20bar")
        assert search.status_code == 200
        assert len(search.json()["items"]) == 2

        with TestingSessionLocal() as db:
            conflicts = db.scalars(select(FoodSourceConflict)).all()
            assert len(conflicts) == 1
            conflict = conflicts[0]
            assert conflict.conflict_type == "nutrition_substantial_difference"
            assert conflict.first_detected_at is not None
            assert conflict.last_detected_at is not None
            assert conflict.evidence_json["first"]["nutrientsPer100g"]
            assert conflict.evidence_json["second"]["nutrientsPer100g"]

        detail = client.get("/api/v1/foods/usda:bar-1")
        assert detail.status_code == 200
        detail_body = detail.json()
        assert "duplicate_nutrition_conflict" in detail_body["qualityFlags"]
        assert len(detail_body["sourceConflicts"]) == 1
        source_conflict = detail_body["sourceConflicts"][0]
        assert source_conflict["conflictingProvider"] == "open_food_facts"
        assert source_conflict["conflictingExternalId"] == "bar-2"
        assert source_conflict["conflictingDisplayName"] == "Protein bar"
        assert source_conflict["conflictType"] == "nutrition_substantial_difference"
        assert source_conflict["isCurrentConflict"] is True

        with TestingSessionLocal() as db:
            open_food_facts_record = db.scalar(
                select(FoodSourceRecord).where(
                    FoodSourceRecord.provider == "open_food_facts",
                    FoodSourceRecord.external_id == "bar-2",
                )
            )
            assert open_food_facts_record is not None
            open_food_facts_record.nutrients_per_100g = {
                "caloriesKcal": 180,
                "proteinGrams": 20,
                "carbohydrateGrams": 20,
                "fatGrams": 4,
            }
            db.commit()

        resolved_detail = client.get("/api/v1/foods/usda:bar-1")
        assert resolved_detail.status_code == 200
        resolved_body = resolved_detail.json()
        assert "duplicate_nutrition_conflict" not in resolved_body["qualityFlags"]
        assert len(resolved_body["sourceConflicts"]) == 1
        assert resolved_body["sourceConflicts"][0]["isCurrentConflict"] is False
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


def test_food_correction_report_replays_an_exact_mobile_retry_without_duplication() -> None:
    engine, TestingSessionLocal = create_test_session_factory()
    Base.metadata.create_all(bind=engine)

    with TestingSessionLocal() as db:
        source_record = FoodSourceRecord(
            provider="usda",
            external_id="idempotency-banana",
            display_name="Bananas, raw",
            data_type="Foundation",
            nutrients_per_100g={
                "caloriesKcal": 89,
                "proteinGrams": 1.1,
                "carbohydrateGrams": 22.8,
                "fatGrams": 0.3,
            },
            original_nutrient_ids={},
            quality_flags=[],
            source_reference="https://fdc.nal.usda.gov/",
            retrieved_at=datetime.now(timezone.utc),
        )
        db.add(source_record)
        db.commit()
        food_id = source_record.id

    app.dependency_overrides[get_db] = override_db(TestingSessionLocal)
    payload = {
        "reportType": "wrong_nutrients",
        "message": "The listed calories look incorrect for this source record.",
    }

    try:
        client = TestClient(app)
        session = client.post(
            "/api/v1/auth/register",
            json={"email": "idempotent-reporter@example.com", "password": "local-password-123"},
        )
        headers = {
            "Authorization": f"Bearer {session.json()['token']}",
            "Idempotency-Key": "correction-report-retry-1",
        }

        created = client.post(f"/api/v1/foods/{food_id}/correction-reports", headers=headers, json=payload)
        replayed = client.post(f"/api/v1/foods/{food_id}/correction-reports", headers=headers, json=payload)

        assert created.status_code == 201
        assert replayed.status_code == 201
        assert replayed.json() == created.json()

        changed_payload = {**payload, "message": "This is a different correction report message."}
        changed_reuse = client.post(
            f"/api/v1/foods/{food_id}/correction-reports",
            headers=headers,
            json=changed_payload,
        )
        assert changed_reuse.status_code == 409

        with TestingSessionLocal() as db:
            assert db.query(DataCorrectionReport).count() == 1
            record = db.scalar(select(IdempotencyRecord))
            assert record is not None
            assert record.operation == "food.correction-report.create"
            assert record.resource_id == created.json()["id"]
            assert payload["message"] not in str(record.response_body_json)
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
        self.result: FoodSearchResult | None = barcode_result("Cached protein drink", 90)

    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        self.barcode_calls += 1
        return self.result


class UnavailableBarcodeRegistry(FakeProviderRegistry):
    async def get_food_by_barcode(self, barcode: str) -> FoodSearchResult | None:
        raise NutritionProviderUnavailableError("No provider completed the barcode lookup.")


def barcode_result(display_name: str, calories_kcal: float) -> FoodSearchResult:
    return FoodSearchResult(
        id="open_food_facts:123456789012",
        display_name=display_name,
        provider=ProviderName.open_food_facts,
        external_id="123456789012",
        data_type="packaged_food",
        brand_owner="Local Brand",
        nutrients_per_100g=NutrientsPer100g(
            calories_kcal=calories_kcal,
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
