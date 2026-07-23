from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.metrics import metrics
from app.db.base import Base
from app.models.food import FoodSourceRecord
from app.models.worker import WorkerHeartbeat
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult, ProviderName
from app.workers.food_source_refresh import run_once, select_due_source_record_ids
import app.models as _models  # noqa: F401


async def test_worker_refreshes_only_a_bounded_stale_provider_batch() -> None:
    factory = create_test_session_factory()
    old_record, newer_old_record, fresh_record, custom_record = add_source_records(factory)
    registry = RefreshRegistry()

    considered = await run_once(session_factory=factory, registry=registry, batch_size=1)

    assert considered == 1
    assert registry.calls == [f"open_food_facts:{old_record.external_id}"]
    with factory() as db:
        refreshed = db.get(FoodSourceRecord, old_record.id)
        still_stale = db.get(FoodSourceRecord, newer_old_record.id)
        fresh = db.get(FoodSourceRecord, fresh_record.id)
        custom = db.get(FoodSourceRecord, custom_record.id)
        assert refreshed is not None
        assert refreshed.display_name == "Fresh protein drink"
        assert still_stale is not None and still_stale.display_name == "Later stale drink"
        assert fresh is not None and fresh.display_name == "Fresh source drink"
        assert custom is not None and custom.display_name == "My private drink"
        heartbeat = db.scalar(
            select(WorkerHeartbeat).where(WorkerHeartbeat.worker_name == "food_source_refresh")
        )
        assert heartbeat is not None


async def test_worker_respects_refresh_backoff_and_preserves_stale_snapshot_on_failure() -> None:
    factory = create_test_session_factory()
    old_record, *_ = add_source_records(factory, include_extra=False)
    registry = FailingRefreshRegistry()

    considered = await run_once(session_factory=factory, registry=registry, batch_size=5)

    assert considered == 1
    assert registry.calls == [f"open_food_facts:{old_record.external_id}"]
    with factory() as db:
        persisted = db.get(FoodSourceRecord, old_record.id)
        assert persisted is not None
        assert persisted.display_name == "Old protein drink"
        assert persisted.refresh_failure_count == 1
        assert persisted.refresh_not_before is not None
        retry_at = persisted.refresh_not_before
        if retry_at.tzinfo is None:  # SQLite does not round-trip timezone metadata.
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        assert retry_at > datetime.now(timezone.utc)
        assert select_due_source_record_ids(session_factory=factory, limit=5) == []

    rendered_metrics = metrics.render_prometheus()
    assert (
        'living_nutrition_food_cache_events_total{cache="source_record",operation="scheduled_refresh",outcome="refresh_failed"} 1'
        in rendered_metrics
    )


def create_test_session_factory() -> sessionmaker[Session]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def add_source_records(
    factory: sessionmaker[Session], *, include_extra: bool = True
) -> tuple[FoodSourceRecord, FoodSourceRecord | None, FoodSourceRecord | None, FoodSourceRecord | None]:
    now = datetime.now(timezone.utc)
    old_record = FoodSourceRecord(
        provider="open_food_facts",
        external_id="stale-1",
        display_name="Old protein drink",
        data_type="packaged_food",
        brand_owner="Example",
        nutrients_per_100g=nutrients(90),
        original_nutrient_ids={},
        quality_flags=[],
        source_reference="https://example.test/stale-1",
        retrieved_at=now - timedelta(days=300),
    )
    extra_records: list[FoodSourceRecord] = []
    if include_extra:
        extra_records = [
            FoodSourceRecord(
                provider="open_food_facts",
                external_id="stale-2",
                display_name="Later stale drink",
                data_type="packaged_food",
                brand_owner="Example",
                nutrients_per_100g=nutrients(100),
                original_nutrient_ids={},
                quality_flags=[],
                source_reference="https://example.test/stale-2",
                retrieved_at=now - timedelta(days=200),
            ),
            FoodSourceRecord(
                provider="usda",
                external_id="fresh-1",
                display_name="Fresh source drink",
                data_type="Foundation",
                brand_owner=None,
                nutrients_per_100g=nutrients(110),
                original_nutrient_ids={},
                quality_flags=[],
                source_reference="https://example.test/fresh-1",
                retrieved_at=now - timedelta(days=1),
            ),
            FoodSourceRecord(
                provider="user",
                external_id="private-1",
                display_name="My private drink",
                data_type="custom_food",
                brand_owner=None,
                nutrients_per_100g=nutrients(120),
                original_nutrient_ids={},
                quality_flags=[],
                source_reference="user:private-1",
                retrieved_at=now - timedelta(days=400),
            ),
        ]
    with factory() as db:
        db.add_all([old_record, *extra_records])
        db.commit()
        db.refresh(old_record)
        for record in extra_records:
            db.refresh(record)

    return (
        old_record,
        extra_records[0] if include_extra else None,
        extra_records[1] if include_extra else None,
        extra_records[2] if include_extra else None,
    )


def nutrients(calories_kcal: float) -> dict[str, float]:
    return {
        "caloriesKcal": calories_kcal,
        "proteinGrams": 12,
        "carbohydrateGrams": 6,
        "fatGrams": 2,
    }


class RefreshRegistry:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        self.calls.append(food_id)
        return FoodSearchResult(
            id=food_id,
            display_name="Fresh protein drink",
            provider=ProviderName.open_food_facts,
            external_id="stale-1",
            data_type="packaged_food",
            brand_owner="Example",
            nutrients_per_100g=NutrientsPer100g(
                calories_kcal=120,
                protein_grams=18,
                carbohydrate_grams=8,
                fat_grams=2,
            ),
            original_nutrient_ids={},
            quality_flags=[],
            record_confidence=ConfidenceTier.medium,
            source_reference="https://example.test/stale-1",
            retrieved_at=datetime.now(timezone.utc),
        )


class FailingRefreshRegistry(RefreshRegistry):
    async def get_food_by_id(self, food_id: str) -> FoodSearchResult | None:
        self.calls.append(food_id)
        raise RuntimeError("provider unavailable")
