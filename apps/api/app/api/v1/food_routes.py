from datetime import datetime, timedelta, timezone
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.nutrition_label_analyzer import analyze_nutrition_label
from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.analysis import DataCorrectionReport
from app.models.food import CustomFood, FoodSourceRecord
from app.models.user import FavoriteFood, RecentFood
from app.nutrition.provider_registry import (
    NutritionProviderRegistry,
    get_provider_registry,
    rank_food_results,
)
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import (
    CustomFoodCreate,
    FoodCorrectionReportCreate,
    FoodCorrectionReportRead,
    FoodDetail,
    FoodSearchResponse,
    FoodSearchResult,
    FoodServingOption,
    NutritionLabelAnalysis,
    NutritionLabelAnalysisRequest,
    ProviderName,
)

router = APIRouter()
STALE_SOURCE_RECORD_DAYS = 180
STALE_SOURCE_RECORD_FLAG = "stale_source_record"
DUPLICATE_NUTRITION_CONFLICT_FLAG = "duplicate_nutrition_conflict"


@router.get("/search", response_model=FoodSearchResponse)
async def search_foods(
    query: str = Query(min_length=2),
    locale: str = "en-US",
    db: Session = Depends(get_db),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodSearchResponse:
    cached_records = search_cached_food_records(query, db)
    cache_first_items = cache_first_search_items(query, cached_records)

    if cache_first_items:
        return FoodSearchResponse(
            items=rank_food_results(
                flag_duplicate_nutrition_conflicts(cache_first_items),
                query,
            )
        )

    try:
        provider_response = await registry.search_foods(query=query, locale=locale)
    except Exception:
        if cached_records:
            fallback_items = flag_duplicate_nutrition_conflicts(
                [food_result_from_record(record) for record in cached_records]
            )
            return FoodSearchResponse(
                items=rank_food_results(
                    fallback_items,
                    query,
                )
            )
        raise

    cached_provider_records = [cache_food_result(db, item) for item in provider_response.items]
    if cached_provider_records:
        db.commit()

    merged = merge_food_results(
        [food_result_from_record(record) for record in cached_provider_records],
        [food_result_from_record(record) for record in cached_records],
    )
    return FoodSearchResponse(items=rank_food_results(flag_duplicate_nutrition_conflicts(merged), query))


@router.get("/barcode/{barcode}", response_model=FoodSearchResponse)
async def get_food_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodSearchResponse:
    custom_record = get_custom_food_by_barcode(db, current_user.id, barcode)

    if custom_record:
        return FoodSearchResponse(items=[food_result_from_record(custom_record)])

    cached_record = get_cached_barcode_record(db, barcode)

    if cached_record:
        return FoodSearchResponse(items=[food_result_from_record(cached_record)])

    result = await registry.get_food_by_barcode(barcode)

    if not result:
        return FoodSearchResponse(items=[])

    cached_result = cache_food_result(db, result)
    db.commit()

    return FoodSearchResponse(items=[food_result_from_record(cached_result)])


@router.get("/custom", response_model=FoodSearchResponse)
def list_custom_foods(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodSearchResponse:
    records = db.scalars(
        select(FoodSourceRecord)
        .join(CustomFood, CustomFood.food_source_record_id == FoodSourceRecord.id)
        .where(CustomFood.user_id == current_user.id)
        .order_by(CustomFood.created_at.desc())
        .limit(limit)
    ).all()

    return FoodSearchResponse(items=[food_result_from_record(record) for record in records])


@router.post("/label-analysis", response_model=NutritionLabelAnalysis)
async def create_nutrition_label_analysis(
    request: NutritionLabelAnalysisRequest,
    current_user: CurrentUser = Depends(ensure_current_user),
) -> NutritionLabelAnalysis:
    return await analyze_nutrition_label(request.image_base64, request.barcode)


@router.patch("/custom/{food_id:path}", response_model=FoodDetail)
def update_custom_food(
    food_id: str,
    custom_food: CustomFoodCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodDetail:
    source_record, custom_food_record = get_owned_custom_food_or_404(food_id, db, current_user.id)
    apply_custom_food_update(source_record, custom_food_record, custom_food)
    db.commit()
    db.refresh(source_record)

    return food_detail_from_result(food_result_from_record(source_record))


@router.get("/recent", response_model=FoodSearchResponse)
def list_recent_foods(
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodSearchResponse:
    records = db.scalars(
        select(FoodSourceRecord)
        .join(RecentFood, RecentFood.food_source_record_id == FoodSourceRecord.id)
        .where(RecentFood.user_id == current_user.id)
        .order_by(RecentFood.last_used_at.desc())
        .limit(limit)
    ).all()

    return FoodSearchResponse(items=[food_result_from_record(record) for record in records])


@router.delete("/recent/{food_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def remove_recent_food(
    food_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    stored_record = get_stored_food_source_record(food_id, db)

    if not stored_record:
        return

    recent = db.scalar(
        select(RecentFood).where(
            RecentFood.user_id == current_user.id,
            RecentFood.food_source_record_id == stored_record.id,
        )
    )

    if recent:
        db.delete(recent)
        db.commit()


@router.get("/favorites", response_model=FoodSearchResponse)
def list_favorite_foods(
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodSearchResponse:
    records = db.scalars(
        select(FoodSourceRecord)
        .join(FavoriteFood, FavoriteFood.food_source_record_id == FoodSourceRecord.id)
        .where(FavoriteFood.user_id == current_user.id)
        .order_by(FavoriteFood.created_at.desc())
        .limit(limit)
    ).all()

    return FoodSearchResponse(items=[food_result_from_record(record) for record in records])


@router.put("/favorites/{food_id:path}", response_model=FoodSearchResult)
async def add_favorite_food(
    food_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodSearchResult:
    source_record = await resolve_food_source_record(food_id, db, registry)

    if not source_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    existing = db.scalar(
        select(FavoriteFood).where(
            FavoriteFood.user_id == current_user.id,
            FavoriteFood.food_source_record_id == source_record.id,
        )
    )

    if not existing:
        db.add(
            FavoriteFood(
                user_id=current_user.id,
                food_source_record_id=source_record.id,
            )
        )
        db.commit()

    return food_result_from_record(source_record)


@router.delete("/favorites/{food_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def remove_favorite_food(
    food_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    stored_record = get_stored_food_source_record(food_id, db)

    if not stored_record:
        return

    favorite = db.scalar(
        select(FavoriteFood).where(
            FavoriteFood.user_id == current_user.id,
            FavoriteFood.food_source_record_id == stored_record.id,
        )
    )

    if favorite:
        db.delete(favorite)
        db.commit()


@router.post("/{food_id}/correction-reports", response_model=FoodCorrectionReportRead, status_code=status.HTTP_201_CREATED)
async def create_food_correction_report(
    food_id: str,
    correction_report: FoodCorrectionReportCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodCorrectionReportRead:
    source_record = await resolve_food_source_record(food_id, db, registry)

    if not source_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    report = DataCorrectionReport(
        user_id=current_user.id,
        food_source_record_id=source_record.id,
        report_type=correction_report.report_type,
        message=correction_report.message.strip(),
        status="open",
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return FoodCorrectionReportRead(
        id=report.id,
        food_source_record_id=report.food_source_record_id,
        report_type=report.report_type,
        message=report.message,
        status=report.status,
        created_at=report.created_at,
    )


@router.get("/{food_id}", response_model=FoodDetail)
async def get_food(
    food_id: str,
    db: Session = Depends(get_db),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodDetail:
    stored_record = get_stored_food_source_record(food_id, db)
    if stored_record:
        refreshed_record = await refresh_stale_source_record(stored_record, db, registry)
        return food_detail_from_result(food_result_from_record(refreshed_record))

    result = await registry.get_food_by_id(food_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    source_record = cache_food_result(db, result)
    db.commit()

    return food_detail_from_result(food_result_from_record(source_record))


@router.post("/custom", response_model=FoodDetail, status_code=status.HTTP_201_CREATED)
def create_custom_food(
    custom_food: CustomFoodCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodDetail:
    normalized_barcode = normalize_barcode(custom_food.barcode)
    external_id = (
        custom_barcode_external_id(current_user.id, normalized_barcode)
        if normalized_barcode
        else f"custom:{current_user.id}:{datetime.now(timezone.utc).timestamp()}"
    )
    existing_record = db.scalar(
        select(FoodSourceRecord).where(
            FoodSourceRecord.provider == ProviderName.user,
            FoodSourceRecord.external_id == external_id,
        )
    )

    if existing_record:
        custom_food_record = db.scalar(
            select(CustomFood).where(
                CustomFood.user_id == current_user.id,
                CustomFood.food_source_record_id == existing_record.id,
            )
        )

        if custom_food_record:
            apply_custom_food_update(existing_record, custom_food_record, custom_food)
            db.commit()
            db.refresh(existing_record)
            return food_detail_from_result(food_result_from_record(existing_record))

    source_record = FoodSourceRecord(
        provider=ProviderName.user,
        external_id=external_id,
        display_name=custom_food.display_name,
        data_type="custom_packaged_food" if normalized_barcode else "custom_food",
        brand_owner=custom_food.brand_owner,
        nutrients_per_100g=custom_food.nutrients_per_100g.model_dump(),
        serving_size=custom_food.serving_size,
        serving_size_unit=custom_food.serving_size_unit,
        household_serving_text=custom_food.household_serving_text,
        original_nutrient_ids={},
        quality_flags=[],
        source_reference=f"user-created barcode {normalized_barcode}" if normalized_barcode else "user-created",
        retrieved_at=datetime.now(timezone.utc),
    )
    db.add(source_record)
    db.flush()
    db.add(
        CustomFood(
            user_id=current_user.id,
            food_source_record_id=source_record.id,
            display_name=custom_food.display_name,
            notes=custom_food.notes,
            verified_by_user=True,
        )
    )
    db.commit()
    db.refresh(source_record)

    return food_detail_from_result(food_result_from_record(source_record))


def apply_custom_food_update(
    source_record: FoodSourceRecord,
    custom_food_record: CustomFood,
    custom_food: CustomFoodCreate,
) -> None:
    barcode = normalize_barcode(custom_food.barcode) or barcode_from_custom_external_id(source_record.external_id)
    source_record.display_name = custom_food.display_name
    source_record.brand_owner = custom_food.brand_owner
    source_record.nutrients_per_100g = custom_food.nutrients_per_100g.model_dump()
    source_record.serving_size = custom_food.serving_size
    source_record.serving_size_unit = custom_food.serving_size_unit
    source_record.household_serving_text = custom_food.household_serving_text
    source_record.source_reference = (
        f"user-created barcode {barcode}" if barcode else "user-created"
    )
    source_record.retrieved_at = datetime.now(timezone.utc)
    custom_food_record.display_name = custom_food.display_name
    custom_food_record.notes = custom_food.notes
    custom_food_record.verified_by_user = True


def get_custom_food_by_barcode(db: Session, user_id: str, barcode: str) -> FoodSourceRecord | None:
    external_id = custom_barcode_external_id(user_id, barcode)

    return db.scalar(
        select(FoodSourceRecord)
        .join(CustomFood, CustomFood.food_source_record_id == FoodSourceRecord.id)
        .where(
            CustomFood.user_id == user_id,
            FoodSourceRecord.provider == ProviderName.user,
            FoodSourceRecord.external_id == external_id,
        )
    )


def get_cached_barcode_record(db: Session, barcode: str) -> FoodSourceRecord | None:
    normalized_barcode = normalize_barcode(barcode)

    if not normalized_barcode:
        return None

    return db.scalar(
        select(FoodSourceRecord).where(
            FoodSourceRecord.provider == ProviderName.open_food_facts,
            FoodSourceRecord.external_id == normalized_barcode,
        )
    )


def search_cached_food_records(query: str, db: Session, limit: int = 20) -> list[FoodSourceRecord]:
    normalized_query = query.strip()

    if not normalized_query:
        return []

    return list(
        db.scalars(
            select(FoodSourceRecord)
            .where(FoodSourceRecord.display_name.ilike(f"%{normalized_query}%"))
            .order_by(FoodSourceRecord.updated_at.desc())
            .limit(limit)
        ).all()
    )


def cache_first_search_items(query: str, records: list[FoodSourceRecord]) -> list[FoodSearchResult]:
    normalized_query = normalized_duplicate_name(query)

    if not normalized_query:
        return []

    return [
        food_result_from_record(record)
        for record in records
        if normalized_duplicate_name(record.display_name) == normalized_query
        and not cached_record_requires_refresh(record)
    ]


def cached_record_requires_refresh(record: FoodSourceRecord) -> bool:
    return (
        record.provider != ProviderName.user
        and bool(record.retrieved_at)
        and retrieved_at_is_stale(record.retrieved_at)
    )


def merge_food_results(*groups: list[FoodSearchResult]) -> list[FoodSearchResult]:
    merged: list[FoodSearchResult] = []
    seen: set[tuple[str, str]] = set()

    for group in groups:
        for item in group:
            key = (str(item.provider), item.external_id)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)

    return merged


def flag_duplicate_nutrition_conflicts(items: list[FoodSearchResult]) -> list[FoodSearchResult]:
    normalized_names = {item.id: normalized_duplicate_name(item.display_name) for item in items}
    conflicted_ids: set[str] = set()

    for index, left in enumerate(items):
        left_name = normalized_names[left.id]
        if not left_name or left.provider == ProviderName.user:
            continue

        for right in items[index + 1 :]:
            if right.provider == ProviderName.user or normalized_names[right.id] != left_name:
                continue

            if nutrients_differ_substantially(left.nutrients_per_100g, right.nutrients_per_100g):
                conflicted_ids.add(left.id)
                conflicted_ids.add(right.id)

    return [
        add_quality_flag(item, DUPLICATE_NUTRITION_CONFLICT_FLAG)
        if item.id in conflicted_ids
        else item
        for item in items
    ]


def normalized_duplicate_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def nutrients_differ_substantially(
    left: NutrientsPer100g,
    right: NutrientsPer100g,
) -> bool:
    return (
        values_differ_substantially(left.calories_kcal, right.calories_kcal, 50, 0.3)
        or values_differ_substantially(left.protein_grams, right.protein_grams, 10, 0.5)
        or values_differ_substantially(left.carbohydrate_grams, right.carbohydrate_grams, 15, 0.5)
        or values_differ_substantially(left.fat_grams, right.fat_grams, 10, 0.5)
    )


def values_differ_substantially(
    left: float,
    right: float,
    absolute_threshold: float,
    relative_threshold: float,
) -> bool:
    difference = abs(left - right)
    denominator = max(abs(left), abs(right), 1)
    return difference >= absolute_threshold and difference / denominator >= relative_threshold


def add_quality_flag(item: FoodSearchResult, flag: str) -> FoodSearchResult:
    if flag in item.quality_flags:
        return item

    return item.model_copy(update={"quality_flags": [*item.quality_flags, flag]})


def cache_food_result(db: Session, result: FoodSearchResult) -> FoodSourceRecord:
    existing = db.scalar(
        select(FoodSourceRecord).where(
            FoodSourceRecord.provider == result.provider,
            FoodSourceRecord.external_id == result.external_id,
        )
    )

    if existing:
        apply_food_result_update(existing, result)
        return existing

    source_record = FoodSourceRecord(
        provider=result.provider,
        external_id=result.external_id,
        display_name=result.display_name,
        data_type=result.data_type,
        brand_owner=result.brand_owner,
        publication_date=result.publication_date,
        nutrients_per_100g=result.nutrients_per_100g.model_dump(),
        serving_size=result.serving_size,
        serving_size_unit=result.serving_size_unit,
        household_serving_text=result.household_serving_text,
        original_nutrient_ids=result.original_nutrient_ids,
        quality_flags=result.quality_flags,
        source_reference=result.source_reference,
        retrieved_at=result.retrieved_at,
    )
    db.add(source_record)
    db.flush()

    return source_record


def apply_food_result_update(source_record: FoodSourceRecord, result: FoodSearchResult) -> None:
    source_record.display_name = result.display_name
    source_record.data_type = result.data_type
    source_record.brand_owner = result.brand_owner
    source_record.publication_date = result.publication_date
    source_record.nutrients_per_100g = result.nutrients_per_100g.model_dump()
    source_record.serving_size = result.serving_size
    source_record.serving_size_unit = result.serving_size_unit
    source_record.household_serving_text = result.household_serving_text
    source_record.original_nutrient_ids = result.original_nutrient_ids
    source_record.quality_flags = result.quality_flags
    source_record.source_reference = result.source_reference
    source_record.retrieved_at = result.retrieved_at


async def refresh_stale_source_record(
    source_record: FoodSourceRecord,
    db: Session,
    registry: NutritionProviderRegistry,
) -> FoodSourceRecord:
    if (
        source_record.provider == ProviderName.user
        or not source_record.retrieved_at
        or not retrieved_at_is_stale(source_record.retrieved_at)
    ):
        return source_record

    try:
        fresh_result = await registry.get_food_by_id(
            f"{source_record.provider}:{source_record.external_id}"
        )
    except Exception:
        return source_record

    if not fresh_result:
        return source_record

    refreshed_record = cache_food_result(db, fresh_result)
    db.commit()
    db.refresh(refreshed_record)
    return refreshed_record


def custom_barcode_external_id(user_id: str, barcode: str | None) -> str:
    return f"custom-barcode:{user_id}:{normalize_barcode(barcode)}"


def normalize_barcode(barcode: str | None) -> str:
    return "".join(character for character in str(barcode or "") if character.isdigit())


def barcode_from_custom_external_id(external_id: str) -> str | None:
    prefix = "custom-barcode:"

    if not external_id.startswith(prefix):
        return None

    _, _, barcode = external_id.rpartition(":")
    return barcode or None


def get_stored_food_source_record(food_id: str, db: Session) -> FoodSourceRecord | None:
    stored_record = db.scalar(select(FoodSourceRecord).where(FoodSourceRecord.id == food_id))
    if stored_record:
        return stored_record

    provider_name, _, external_id = food_id.partition(":")
    if provider_name and external_id:
        return db.scalar(
            select(FoodSourceRecord).where(
                FoodSourceRecord.provider == provider_name,
                FoodSourceRecord.external_id == external_id,
            )
        )

    return None


def get_owned_custom_food_or_404(
    food_id: str,
    db: Session,
    user_id: str,
) -> tuple[FoodSourceRecord, CustomFood]:
    source_record = get_stored_food_source_record(food_id, db)

    if not source_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom food not found.")

    custom_food = db.scalar(
        select(CustomFood).where(
            CustomFood.user_id == user_id,
            CustomFood.food_source_record_id == source_record.id,
        )
    )

    if not custom_food:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom food not found.")

    return source_record, custom_food


async def resolve_food_source_record(
    food_id: str,
    db: Session,
    registry: NutritionProviderRegistry,
) -> FoodSourceRecord | None:
    stored_record = get_stored_food_source_record(food_id, db)

    if stored_record:
        return stored_record

    result = await registry.get_food_by_id(food_id)

    if not result:
        return None

    source_record = FoodSourceRecord(
        provider=result.provider,
        external_id=result.external_id,
        display_name=result.display_name,
        data_type=result.data_type,
        brand_owner=result.brand_owner,
        publication_date=result.publication_date,
        nutrients_per_100g=result.nutrients_per_100g.model_dump(),
        serving_size=result.serving_size,
        serving_size_unit=result.serving_size_unit,
        household_serving_text=result.household_serving_text,
        original_nutrient_ids=result.original_nutrient_ids,
        quality_flags=result.quality_flags,
        source_reference=result.source_reference,
        retrieved_at=result.retrieved_at,
    )
    db.add(source_record)
    db.flush()

    return source_record


def food_detail_from_result(result: FoodSearchResult) -> FoodDetail:
    serving_options: list[FoodServingOption] = [
        FoodServingOption(label="100 grams", quantity=100, unit="grams", grams=100)
    ]

    if result.serving_size and result.serving_size_unit:
        unit = result.serving_size_unit.lower()
        serving_options.append(
            FoodServingOption(
                label=result.household_serving_text
                or f"{result.serving_size:g} {result.serving_size_unit}",
                quantity=1,
                unit="serving",
                grams=result.serving_size if unit in {"g", "gram", "grams"} else None,
            )
        )

    return FoodDetail(
        **result.model_dump(),
        serving_options=serving_options,
        provenance_summary=(
            f"{result.provider} {result.data_type} record retrieved at "
            f"{result.retrieved_at.isoformat()}."
        ),
    )


def food_result_from_record(record: FoodSourceRecord) -> FoodSearchResult:
    return FoodSearchResult(
        id=f"{record.provider}:{record.external_id}",
        display_name=record.display_name,
        provider=ProviderName(record.provider),
        external_id=record.external_id,
        data_type=record.data_type,
        brand_owner=record.brand_owner,
        publication_date=record.publication_date,
        serving_size=record.serving_size,
        serving_size_unit=record.serving_size_unit,
        household_serving_text=record.household_serving_text,
        nutrients_per_100g=NutrientsPer100g.model_validate(record.nutrients_per_100g),
        original_nutrient_ids=record.original_nutrient_ids,
        quality_flags=quality_flags_for_record(record),
        record_confidence=ConfidenceTier.verified if record.provider == ProviderName.user else ConfidenceTier.medium,
        source_reference=record.source_reference,
        retrieved_at=record.retrieved_at,
    )


def quality_flags_for_record(record: FoodSourceRecord) -> list[str]:
    flags = list(record.quality_flags or [])

    if (
        record.provider != ProviderName.user
        and record.retrieved_at
        and retrieved_at_is_stale(record.retrieved_at)
        and STALE_SOURCE_RECORD_FLAG not in flags
    ):
        flags.append(STALE_SOURCE_RECORD_FLAG)

    return flags


def retrieved_at_is_stale(value: datetime) -> bool:
    normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - normalized > timedelta(days=STALE_SOURCE_RECORD_DAYS)
