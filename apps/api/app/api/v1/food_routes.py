from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.analysis.meal_analyzer import sanitize_base64_image
from app.analysis.nutrition_label_analyzer import analyze_nutrition_label
from app.core.ai_quota import (
    AI_OPERATION_LABEL_ANALYSIS,
    AiQuotaExceededError,
    quota_response_headers,
    refund_ai_usage,
    reserve_ai_usage,
    settle_ai_usage,
)
from app.core.auth import CurrentUser, ensure_current_user
from app.core.authorization import raise_owner_scoped_not_found
from app.core.audit import record_audit_event
from app.core.config import settings
from app.core.idempotency import (
    CUSTOM_FOOD_CREATE_OPERATION,
    FOOD_CORRECTION_REPORT_CREATE_OPERATION,
    NUTRITION_LABEL_ANALYSIS_OPERATION,
    complete_idempotency_key,
    digest_sensitive_request_value,
    discard_idempotency_key,
    get_completed_replay,
    reserve_idempotency_key,
    resolve_idempotency_key,
)
from app.core.middleware import get_request_id
from app.core.metrics import metrics
from app.db.session import get_db
from app.models.analysis import DataCorrectionReport
from app.models.food import (
    CustomFood,
    FoodSearchCache,
    FoodSourceConflict,
    FoodSourceRecord,
    FoodSourceRevision,
)
from app.models.user import FavoriteFood, FavoriteFoodTag, FavoriteFoodTagAssignment, RecentFood
from app.nutrition.provider_registry import (
    NutritionProviderRegistry,
    get_provider_registry,
    rank_food_results,
)
from app.nutrition.food_quality import assess_food_quality
from app.nutrition.provider import NutritionProviderUnavailableError
from app.nutrition.providers.e2e_fixture import E2E_RATE_LIMIT_QUERY
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import (
    CustomFoodCreate,
    FoodCorrectionReportCreate,
    FoodCorrectionReportRead,
    FoodCorrectionReportStatusHistoryRead,
    FoodDetail,
    FavoriteFoodTagsUpdate,
    FoodQualityAssessment,
    FoodSearchResponse,
    FoodSearchResult,
    FoodSourceConflictRead,
    FoodSourceRevisionRead,
    FoodServingOption,
    NutritionLabelAnalysis,
    NutritionLabelAnalysisRequest,
    ProviderName,
)
from app.services.correction_reports import add_status_event, status_events_for_report

router = APIRouter()
STALE_SOURCE_RECORD_DAYS = 180
STALE_SOURCE_RECORD_FLAG = "stale_source_record"
DUPLICATE_NUTRITION_CONFLICT_FLAG = "duplicate_nutrition_conflict"
DUPLICATE_NUTRITION_CONFLICT_TYPE = "nutrition_substantial_difference"


@router.get("/search", response_model=FoodSearchResponse)
async def search_foods(
    request: Request,
    query: str = Query(min_length=2),
    locale: str = "en-US",
    _current_user: CurrentUser = Depends(ensure_current_user),
    db: Session = Depends(get_db),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodSearchResponse | JSONResponse:
    normalized_query = normalize_search_query(query)

    if settings.e2e_fixture_mode and normalized_query == E2E_RATE_LIMIT_QUERY:
        # Device E2E needs a deterministic 429 without sharing a mutable rate
        # budget across unrelated flows. Keep the exact production envelope and
        # retry header, but gate it behind the production-rejected fixture mode.
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "error": {
                    "message": "Too many requests. Please wait and try again.",
                    "code": "rate_limited",
                    "requestId": get_request_id(request),
                }
            },
            headers={"Retry-After": "1"},
        )

    query_cache_records = get_fresh_search_cache_records(normalized_query, locale, db)

    # An empty list is an intentional cached no-result response; None means the
    # cached index is missing, expired, incomplete, or refers to stale source data.
    if query_cache_records is not None:
        metrics.record_food_cache_event(
            cache="query_index", operation="search", outcome="fresh_hit"
        )
        return FoodSearchResponse(
            items=rank_food_results(
                flag_duplicate_nutrition_conflicts(
                    food_results_from_records_with_conflicts(query_cache_records, db)
                ),
                query,
            )
        )

    # Search exposes a shared provider catalog to authenticated accounts.
    # User-created foods are deliberately kept out of this shared cache path
    # and remain available only through their owner-scoped custom-food routes.
    cached_records = search_cached_food_records(query, db)
    cache_first_items = cache_first_search_items(query, cached_records)

    if cache_first_items:
        metrics.record_food_cache_event(
            cache="source_record", operation="search", outcome="fresh_exact_hit"
        )
        return FoodSearchResponse(
            items=rank_food_results(
                flag_duplicate_nutrition_conflicts(
                    add_persisted_duplicate_conflict_flags(cache_first_items, db)
                ),
                query,
            )
        )

    try:
        provider_response = await registry.search_foods(query=query, locale=locale)
    except NutritionProviderUnavailableError:
        if cached_records:
            metrics.record_food_cache_event(
                cache="source_record", operation="search", outcome="stale_fallback"
            )
            fallback_items = flag_duplicate_nutrition_conflicts(
                food_results_from_records_with_conflicts(cached_records, db)
            )
            return FoodSearchResponse(
                items=rank_food_results(
                    fallback_items,
                    query,
                )
            )
        raise

    cached_provider_records = [cache_food_result(db, item) for item in provider_response.items]
    persist_duplicate_nutrition_conflicts(
        [*cached_provider_records, *cached_records],
        db,
    )
    cache_search_response(
        db,
        normalized_query=normalized_query,
        locale=locale,
        source_records=cached_provider_records,
    )
    metrics.record_food_cache_event(
        cache="query_index", operation="search", outcome="refreshed"
    )
    db.commit()

    merged = merge_food_results(
        food_results_from_records_with_conflicts(cached_provider_records, db),
        food_results_from_records_with_conflicts(cached_records, db),
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
        metrics.record_food_cache_event(
            cache="custom_record", operation="barcode", outcome="hit"
        )
        return FoodSearchResponse(items=[food_result_from_record(custom_record)])

    cached_record = get_cached_barcode_record(db, barcode)

    if cached_record:
        metrics.record_food_cache_event(
            cache="source_record", operation="barcode", outcome="hit"
        )
        refreshed_record = await refresh_stale_barcode_record(cached_record, barcode, db, registry)
        return FoodSearchResponse(
            items=add_persisted_duplicate_conflict_flags(
                [food_result_from_record(refreshed_record)],
                db,
            )
        )

    result = await registry.get_food_by_barcode(barcode)

    if not result:
        metrics.record_food_cache_event(
            cache="source_record", operation="barcode", outcome="miss"
        )
        return FoodSearchResponse(items=[])

    cached_result = cache_food_result(db, result)
    persist_duplicate_nutrition_conflicts(
        [cached_result, *search_cached_food_records(cached_result.display_name, db)],
        db,
    )
    metrics.record_food_cache_event(
        cache="source_record", operation="barcode", outcome="refreshed"
    )
    db.commit()

    return FoodSearchResponse(
        items=add_persisted_duplicate_conflict_flags(
            [food_result_from_record(cached_result)],
            db,
        )
    )


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
    label_request: NutritionLabelAnalysisRequest,
    response: Response,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> NutritionLabelAnalysis:
    if not settings.ai_features_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Nutrition-label analysis is unavailable in this free preview. "
                "Enter the label values manually instead."
            ),
        )

    # Reject unsafe or malformed image data before a quota reservation or
    # idempotency record is created. This prevents invalid uploads from
    # consuming an allowance and guarantees provider calls receive only a
    # metadata-free normalized image.
    sanitized_image = sanitize_base64_image(label_request.image_base64)

    resolved_key = resolve_idempotency_key(idempotency_key)
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=NUTRITION_LABEL_ANALYSIS_OPERATION,
        idempotency_key=resolved_key,
        request_payload={
            "imageDigest": digest_sensitive_request_value(label_request.image_base64),
            "barcode": label_request.barcode,
        },
        commit=True,
    )

    if reservation and reservation.is_replay:
        return NutritionLabelAnalysis.model_validate(reservation.replay_body)

    try:
        usage_reservation = reserve_ai_usage(
            db,
            user_id=current_user.id,
            operation=AI_OPERATION_LABEL_ANALYSIS,
            units=1,
            idempotency_key=resolved_key,
        )
    except AiQuotaExceededError:
        discard_idempotency_key(db, reservation)
        raise
    record_audit_event(
        db,
        event_type="ai.quota.reserve",
        user_id=current_user.id,
        request=http_request,
        outcome="reserved",
    )
    db.commit()
    for name, value in quota_response_headers(usage_reservation.quota).items():
        response.headers[name] = value

    try:
        result = await analyze_nutrition_label(
            label_request.image_base64,
            label_request.barcode,
            sanitized_image_base64=sanitized_image,
        )
    except Exception:
        refund_ai_usage(db, usage_reservation, reason="analysis_failure")
        record_audit_event(
            db,
            event_type="ai.quota.refund",
            user_id=current_user.id,
            request=http_request,
            outcome="analysis_failure",
        )
        discard_idempotency_key(db, reservation)
        raise

    settle_ai_usage(db, usage_reservation)
    record_audit_event(
        db,
        event_type="ai.quota.settle",
        user_id=current_user.id,
        request=http_request,
        outcome="settled",
    )
    complete_idempotency_key(
        db,
        reservation,
        result,
        response_status=status.HTTP_200_OK,
        resource_type="nutrition_label_analysis",
        commit=True,
    )
    return result


@router.patch("/custom/{food_id:path}", response_model=FoodDetail)
def update_custom_food(
    food_id: str,
    custom_food: CustomFoodCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodDetail:
    source_record, custom_food_record = get_owned_custom_food_or_404(
        food_id,
        db,
        current_user.id,
        request=request,
    )
    apply_custom_food_update(source_record, custom_food_record, custom_food)
    db.commit()
    db.refresh(source_record)

    return food_detail_from_result(food_result_from_record(source_record))


@router.delete("/custom/{food_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete_custom_food(
    food_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    """Remove a reusable custom record without changing historical meal snapshots."""
    source_record, custom_food_record = get_owned_custom_food_or_404(
        food_id,
        db,
        current_user.id,
        request=request,
    )

    # Remove the current user's saved-food links first. Logged meal items retain
    # their snapshot; their optional source reference is set to null by the FK.
    db.execute(
        delete(FavoriteFood).where(
            FavoriteFood.user_id == current_user.id,
            FavoriteFood.food_source_record_id == source_record.id,
        )
    )
    db.execute(
        delete(RecentFood).where(
            RecentFood.user_id == current_user.id,
            RecentFood.food_source_record_id == source_record.id,
        )
    )
    db.delete(custom_food_record)
    db.flush()
    db.delete(source_record)
    db.commit()


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
    favorites = db.execute(
        select(FavoriteFood, FoodSourceRecord)
        .join(FoodSourceRecord, FavoriteFood.food_source_record_id == FoodSourceRecord.id)
        .where(FavoriteFood.user_id == current_user.id)
        .order_by(FavoriteFood.created_at.desc())
        .limit(limit)
    ).all()
    tags_by_favorite_id = favorite_tags_by_favorite_id(
        db,
        current_user.id,
        [favorite.id for favorite, _record in favorites],
    )

    return FoodSearchResponse(
        items=[
            food_result_from_record(
                record,
                saved_tags=tags_by_favorite_id.get(favorite.id, []),
            )
            for favorite, record in favorites
        ]
    )


@router.put("/favorites/{food_id:path}/tags", response_model=FoodSearchResult)
def replace_favorite_food_tags(
    food_id: str,
    tag_update: FavoriteFoodTagsUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> FoodSearchResult:
    """Replace a favorite's private organization tags for the current account."""

    source_record = get_stored_food_source_record(food_id, db)
    if not source_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Favorite food not found.")

    favorite = db.scalar(
        select(FavoriteFood).where(
            FavoriteFood.user_id == current_user.id,
            FavoriteFood.food_source_record_id == source_record.id,
        )
    )
    if not favorite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Favorite food not found.")

    requested_tags = tag_update.tags
    existing_tags = db.scalars(
        select(FavoriteFoodTag).where(
            FavoriteFoodTag.user_id == current_user.id,
            func.lower(FavoriteFoodTag.name).in_([tag.lower() for tag in requested_tags]),
        )
    ).all() if requested_tags else []
    tags_by_normalized_name = {tag.name.casefold(): tag for tag in existing_tags}
    resolved_tags: list[FavoriteFoodTag] = []

    for name in requested_tags:
        tag = tags_by_normalized_name.get(name.casefold())
        if tag is None:
            tag = FavoriteFoodTag(user_id=current_user.id, name=name)
            db.add(tag)
            db.flush()
            tags_by_normalized_name[name.casefold()] = tag
        resolved_tags.append(tag)

    db.execute(
        delete(FavoriteFoodTagAssignment).where(
            FavoriteFoodTagAssignment.favorite_food_id == favorite.id
        )
    )
    db.add_all(
        FavoriteFoodTagAssignment(
            favorite_food_id=favorite.id,
            favorite_food_tag_id=tag.id,
        )
        for tag in resolved_tags
    )
    db.commit()

    return food_result_from_record(
        source_record,
        saved_tags=[tag.name for tag in resolved_tags],
    )


@router.put("/favorites/{food_id:path}", response_model=FoodSearchResult)
async def add_favorite_food(
    food_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodSearchResult:
    source_record = await resolve_food_source_record(
        food_id,
        db,
        registry,
        current_user.id,
    )

    if not source_record:
        raise_inaccessible_custom_food_or_404(
            food_id,
            db,
            current_user.id,
            request=request,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    existing = db.scalar(
        select(FavoriteFood).where(
            FavoriteFood.user_id == current_user.id,
            FavoriteFood.food_source_record_id == source_record.id,
        )
    )

    if not existing:
        existing = FavoriteFood(
            user_id=current_user.id,
            food_source_record_id=source_record.id,
        )
        db.add(existing)
        db.commit()

    saved_tags = favorite_tags_by_favorite_id(db, current_user.id, [existing.id]).get(existing.id, [])
    return food_result_from_record(source_record, saved_tags=saved_tags)


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
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> FoodCorrectionReportRead:
    source_record = await resolve_food_source_record(
        food_id,
        db,
        registry,
        current_user.id,
    )

    if not source_record:
        raise_inaccessible_custom_food_or_404(
            food_id,
            db,
            current_user.id,
            request=request,
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    resolved_key = resolve_idempotency_key(idempotency_key)
    request_payload = {
        # Use the resolved record ID so alternate provider identifiers for the
        # same source cannot create duplicate reports under one retry key.
        "food_source_record_id": source_record.id,
        "report": correction_report.model_dump(mode="json"),
    }
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=FOOD_CORRECTION_REPORT_CREATE_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
        commit=False,
    )
    if reservation and reservation.is_replay:
        replayed_report = (
            db.get(DataCorrectionReport, reservation.record.resource_id)
            if reservation.record.resource_id
            else None
        )
        if replayed_report and replayed_report.user_id == current_user.id:
            return correction_report_read(replayed_report, db)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This correction report retry can no longer be completed. Submit a new report.",
        )

    report = DataCorrectionReport(
        user_id=current_user.id,
        food_source_record_id=source_record.id,
        report_type=correction_report.report_type,
        message=correction_report.message.strip(),
        status="open",
    )
    db.add(report)
    db.flush()
    add_status_event(
        db,
        correction_report_id=report.id,
        status_value="open",
        actor_user_id=current_user.id,
        user_visible_summary="Report submitted.",
    )
    response = correction_report_read(report, db)
    complete_idempotency_key(
        db,
        reservation,
        # The reporter-facing response includes free-form text. Keep the
        # replay ledger content-free and resolve the owned report by resource
        # ID when the same key is retried.
        {},
        response_status=status.HTTP_201_CREATED,
        resource_type="food_correction_report",
        resource_id=report.id,
        commit=False,
    )
    db.commit()
    return response


def correction_report_read(
    report: DataCorrectionReport,
    db: Session,
) -> FoodCorrectionReportRead:
    """Return only reporter-safe lifecycle data after report creation."""

    return FoodCorrectionReportRead(
        id=report.id,
        food_source_record_id=report.food_source_record_id,
        report_type=report.report_type,
        message=report.message,
        status=report.status,
        resolution_summary=report.resolution_summary,
        created_at=report.created_at,
        updated_at=report.updated_at,
        resolved_at=report.resolved_at,
        status_history=[
            FoodCorrectionReportStatusHistoryRead(
                status=event.status,
                summary=event.user_visible_summary,
                created_at=event.created_at,
            )
            for event in status_events_for_report(db, report.id)
        ],
    )


@router.get("/{food_id}", response_model=FoodDetail)
async def get_food(
    food_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    registry: NutritionProviderRegistry = Depends(get_provider_registry),
) -> FoodDetail:
    stored_record = get_accessible_food_source_record(food_id, db, current_user.id)
    if stored_record:
        metrics.record_food_cache_event(
            cache="source_record", operation="detail", outcome="hit"
        )
        refreshed_record = await refresh_stale_source_record(stored_record, db, registry)
        return food_detail_from_record(refreshed_record, db)

    # A user-created record is private. Do not delegate a guessed custom ID to
    # an external provider, and do not reveal whether another account owns it.
    inaccessible_record = get_stored_food_source_record(food_id, db)
    if is_user_food_identifier(food_id) or inaccessible_record:
        if inaccessible_record and inaccessible_record.provider == ProviderName.user:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=current_user.id,
                detail="Food record not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    result = await registry.get_food_by_id(food_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Food record not found.")

    source_record = cache_food_result(db, result)
    metrics.record_food_cache_event(
        cache="source_record", operation="detail", outcome="refreshed"
    )
    db.commit()

    return food_detail_from_record(source_record, db)


@router.post("/custom", response_model=FoodDetail, status_code=status.HTTP_201_CREATED)
def create_custom_food(
    custom_food: CustomFoodCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> FoodDetail:
    resolved_key = resolve_idempotency_key(idempotency_key)
    request_payload = custom_food.model_dump(mode="json")
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=CUSTOM_FOOD_CREATE_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
        commit=False,
    )

    if reservation and reservation.is_replay:
        return FoodDetail.model_validate(reservation.replay_body)

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

    try:
        if existing_record:
            custom_food_record = db.scalar(
                select(CustomFood).where(
                    CustomFood.user_id == current_user.id,
                    CustomFood.food_source_record_id == existing_record.id,
                )
            )
            if custom_food_record:
                apply_custom_food_update(existing_record, custom_food_record, custom_food)
                db.flush()
                response = food_detail_from_result(food_result_from_record(existing_record))
                complete_idempotency_key(
                    db,
                    reservation,
                    response,
                    response_status=status.HTTP_201_CREATED,
                    resource_type="custom_food",
                    resource_id=existing_record.id,
                    commit=False,
                )
                db.commit()
                return response

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
        db.flush()
        response = food_detail_from_result(food_result_from_record(source_record))
        complete_idempotency_key(
            db,
            reservation,
            response,
            response_status=status.HTTP_201_CREATED,
            resource_type="custom_food",
            resource_id=source_record.id,
            commit=False,
        )
        db.commit()
        return response
    except IntegrityError:
        db.rollback()
        replay = get_completed_replay(
            db,
            user_id=current_user.id,
            operation=CUSTOM_FOOD_CREATE_OPERATION,
            idempotency_key=resolved_key,
            request_payload=request_payload,
        )
        if replay:
            return FoodDetail.model_validate(replay)
        raise


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
            .where(
                FoodSourceRecord.display_name.ilike(f"%{normalized_query}%"),
                FoodSourceRecord.provider != ProviderName.user,
            )
            .order_by(FoodSourceRecord.updated_at.desc())
            .limit(limit)
        ).all()
    )


def normalize_search_query(query: str) -> str:
    """Normalize a user query only for cache identity, never for provider input."""
    return " ".join(query.lower().split())


def get_fresh_search_cache_records(
    normalized_query: str,
    locale: str,
    db: Session,
) -> list[FoodSourceRecord] | None:
    """Return a complete, fresh result set; None signals a safe provider refresh."""
    cache_entry = db.scalar(
        select(FoodSearchCache).where(
            FoodSearchCache.normalized_query == normalized_query,
            FoodSearchCache.locale == locale,
        )
    )

    if not cache_entry or search_cache_is_expired(cache_entry.expires_at):
        return None

    source_record_ids = list(cache_entry.food_source_record_ids or [])
    if not source_record_ids:
        return []

    records = db.scalars(
        select(FoodSourceRecord).where(
            FoodSourceRecord.id.in_(source_record_ids),
            FoodSourceRecord.provider != ProviderName.user,
        )
    ).all()
    records_by_id = {record.id: record for record in records}

    if len(records_by_id) != len(source_record_ids):
        return None

    ordered_records = [records_by_id[record_id] for record_id in source_record_ids]
    if any(cached_record_requires_refresh(record) for record in ordered_records):
        return None

    return ordered_records


def cache_search_response(
    db: Session,
    *,
    normalized_query: str,
    locale: str,
    source_records: list[FoodSourceRecord],
) -> FoodSearchCache:
    """Store result references for a short time without duplicating nutrition data."""
    cache_entry = db.scalar(
        select(FoodSearchCache).where(
            FoodSearchCache.normalized_query == normalized_query,
            FoodSearchCache.locale == locale,
        )
    )
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.food_search_cache_ttl_seconds)
    source_record_ids = [record.id for record in source_records]

    if cache_entry:
        cache_entry.food_source_record_ids = source_record_ids
        cache_entry.expires_at = expires_at
        return cache_entry

    cache_entry = FoodSearchCache(
        normalized_query=normalized_query,
        locale=locale,
        food_source_record_ids=source_record_ids,
        expires_at=expires_at,
    )
    db.add(cache_entry)
    return cache_entry


def search_cache_is_expired(value: datetime) -> bool:
    normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return normalized <= datetime.now(timezone.utc)


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


def persist_duplicate_nutrition_conflicts(
    records: list[FoodSourceRecord],
    db: Session,
) -> None:
    """Retain normalized cross-provider conflict evidence without touching meal snapshots."""
    unique_records = list({record.id: record for record in records}.values())
    now = datetime.now(timezone.utc)

    for index, left in enumerate(unique_records):
        left_name = normalized_duplicate_name(left.display_name)
        if not left_name or left.provider == ProviderName.user:
            continue

        for right in unique_records[index + 1 :]:
            if (
                right.provider == ProviderName.user
                or normalized_duplicate_name(right.display_name) != left_name
                or not nutrients_differ_substantially(
                    NutrientsPer100g.model_validate(left.nutrients_per_100g),
                    NutrientsPer100g.model_validate(right.nutrients_per_100g),
                )
            ):
                continue

            first, second = sorted((left, right), key=lambda record: record.id)
            conflict = db.scalar(
                select(FoodSourceConflict).where(
                    FoodSourceConflict.first_food_source_record_id == first.id,
                    FoodSourceConflict.second_food_source_record_id == second.id,
                    FoodSourceConflict.conflict_type == DUPLICATE_NUTRITION_CONFLICT_TYPE,
                )
            )
            evidence = duplicate_conflict_evidence(first, second)

            if conflict:
                conflict.normalized_name = left_name
                conflict.evidence_json = evidence
                conflict.last_detected_at = now
                continue

            db.add(
                FoodSourceConflict(
                    first_food_source_record_id=first.id,
                    second_food_source_record_id=second.id,
                    normalized_name=left_name,
                    conflict_type=DUPLICATE_NUTRITION_CONFLICT_TYPE,
                    evidence_json=evidence,
                    last_detected_at=now,
                )
            )


def duplicate_conflict_evidence(
    first: FoodSourceRecord,
    second: FoodSourceRecord,
) -> dict[str, object]:
    return {
        "first": {
            "provider": first.provider,
            "externalId": first.external_id,
            "displayName": first.display_name,
            "nutrientsPer100g": first.nutrients_per_100g,
        },
        "second": {
            "provider": second.provider,
            "externalId": second.external_id,
            "displayName": second.display_name,
            "nutrientsPer100g": second.nutrients_per_100g,
        },
    }


def food_results_from_records_with_conflicts(
    records: list[FoodSourceRecord],
    db: Session,
) -> list[FoodSearchResult]:
    return add_persisted_duplicate_conflict_flags(
        [food_result_from_record(record) for record in records],
        db,
    )


def add_persisted_duplicate_conflict_flags(
    items: list[FoodSearchResult],
    db: Session,
) -> list[FoodSearchResult]:
    """Mark cached search results only when the retained conflict is still current."""
    if not items:
        return []

    record_clauses = [
        and_(
            FoodSourceRecord.provider == item.provider,
            FoodSourceRecord.external_id == item.external_id,
        )
        for item in items
        if item.provider != ProviderName.user
    ]
    if not record_clauses:
        return items

    records = db.scalars(select(FoodSourceRecord).where(or_(*record_clauses))).all()
    current_conflict_ids = current_conflict_record_ids(records, db)
    return [
        add_quality_flag(item, DUPLICATE_NUTRITION_CONFLICT_FLAG)
        if any(
            record.id in current_conflict_ids
            and record.provider == item.provider
            and record.external_id == item.external_id
            for record in records
        )
        else item
        for item in items
    ]


def current_conflict_record_ids(
    records: list[FoodSourceRecord],
    db: Session,
) -> set[str]:
    record_ids = {record.id for record in records}
    if not record_ids:
        return set()

    conflicts = db.scalars(
        select(FoodSourceConflict).where(
            or_(
                FoodSourceConflict.first_food_source_record_id.in_(record_ids),
                FoodSourceConflict.second_food_source_record_id.in_(record_ids),
            ),
            FoodSourceConflict.conflict_type == DUPLICATE_NUTRITION_CONFLICT_TYPE,
        )
    ).all()
    related_ids = {
        related_id
        for conflict in conflicts
        for related_id in (
            conflict.first_food_source_record_id,
            conflict.second_food_source_record_id,
        )
    }
    records_by_id = {
        record.id: record
        for record in db.scalars(
            select(FoodSourceRecord).where(FoodSourceRecord.id.in_(related_ids))
        ).all()
    }

    current: set[str] = set()
    for conflict in conflicts:
        first = records_by_id.get(conflict.first_food_source_record_id)
        second = records_by_id.get(conflict.second_food_source_record_id)
        if first and second and records_currently_conflict(first, second):
            current.update((first.id, second.id))
    return current


def records_currently_conflict(first: FoodSourceRecord, second: FoodSourceRecord) -> bool:
    return (
        first.provider != ProviderName.user
        and second.provider != ProviderName.user
        and normalized_duplicate_name(first.display_name)
        == normalized_duplicate_name(second.display_name)
        and nutrients_differ_substantially(
            NutrientsPer100g.model_validate(first.nutrients_per_100g),
            NutrientsPer100g.model_validate(second.nutrients_per_100g),
        )
    )


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

    quality_flags = [*item.quality_flags, flag]
    return item.model_copy(
        update={
            "quality_flags": quality_flags,
            "quality_assessment": quality_assessment_for(item.provider, quality_flags),
        }
    )


def cache_food_result(db: Session, result: FoodSearchResult) -> FoodSourceRecord:
    existing = db.scalar(
        select(FoodSourceRecord).where(
            FoodSourceRecord.provider == result.provider,
            FoodSourceRecord.external_id == result.external_id,
        )
    )

    if existing:
        if (
            existing.provider != ProviderName.user
            and food_source_snapshot_from_record(existing) != food_source_snapshot_from_result(result)
        ):
            add_food_source_revision(db, existing, result)
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

    if source_record.provider != ProviderName.user:
        add_food_source_revision(db, source_record, result)

    return source_record


def add_food_source_revision(
    db: Session,
    source_record: FoodSourceRecord,
    result: FoodSearchResult,
) -> FoodSourceRevision:
    revision = FoodSourceRevision(
        food_source_record_id=source_record.id,
        **food_source_snapshot_from_result(result),
        source_retrieved_at=result.retrieved_at,
    )
    db.add(revision)
    return revision


def food_source_snapshot_from_result(result: FoodSearchResult) -> dict:
    return {
        "display_name": result.display_name,
        "data_type": result.data_type,
        "brand_owner": result.brand_owner,
        "publication_date": result.publication_date,
        "nutrients_per_100g": result.nutrients_per_100g.model_dump(),
        "serving_size": result.serving_size,
        "serving_size_unit": result.serving_size_unit,
        "household_serving_text": result.household_serving_text,
        "original_nutrient_ids": result.original_nutrient_ids,
        "quality_flags": result.quality_flags,
        "source_reference": result.source_reference,
    }


def food_source_snapshot_from_record(record: FoodSourceRecord) -> dict:
    return {
        "display_name": record.display_name,
        "data_type": record.data_type,
        "brand_owner": record.brand_owner,
        "publication_date": record.publication_date,
        "nutrients_per_100g": record.nutrients_per_100g,
        "serving_size": record.serving_size,
        "serving_size_unit": record.serving_size_unit,
        "household_serving_text": record.household_serving_text,
        "original_nutrient_ids": record.original_nutrient_ids,
        "quality_flags": record.quality_flags,
        "source_reference": record.source_reference,
    }


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
    source_record.refresh_attempted_at = None
    source_record.refresh_not_before = None
    source_record.refresh_failure_count = 0


def acquire_stale_source_refresh(
    source_record: FoodSourceRecord,
    db: Session,
) -> bool:
    """Claim one bounded stale refresh without exposing lookup inputs in shared state."""
    if not cached_record_requires_refresh(source_record):
        return False

    now = datetime.now(timezone.utc)
    lease_until = now + timedelta(seconds=settings.food_source_refresh_lease_seconds)
    claimed = db.execute(
        update(FoodSourceRecord)
        .execution_options(synchronize_session=False)
        .where(
            FoodSourceRecord.id == source_record.id,
            or_(
                FoodSourceRecord.refresh_not_before.is_(None),
                FoodSourceRecord.refresh_not_before <= now,
            ),
        )
        .values(
            refresh_attempted_at=now,
            refresh_not_before=lease_until,
            updated_at=now,
        )
    )
    db.commit()

    if claimed.rowcount != 1:
        return False

    db.refresh(source_record)
    return True


def refresh_retry_delay_seconds(source_record_id: str, failure_count: int) -> float:
    """Return a deterministic jittered delay so replica retries do not synchronize."""
    attempts = max(1, failure_count)
    base_delay = min(
        settings.food_source_refresh_retry_max_seconds,
        settings.food_source_refresh_retry_base_seconds * (2 ** min(attempts - 1, 20)),
    )
    jitter_ratio = settings.food_source_refresh_retry_jitter_ratio
    if not jitter_ratio:
        return float(base_delay)

    # The record ID is internal and stable. This produces bounded jitter without
    # adding user input, a barcode, or a query to persisted refresh state.
    digest = sha256(f"{source_record_id}:{attempts}".encode("utf-8")).digest()
    normalized = int.from_bytes(digest[:8], "big") / ((1 << 64) - 1)
    multiplier = (1 - jitter_ratio) + (normalized * jitter_ratio * 2)
    return float(base_delay * multiplier)


def record_stale_source_refresh_failure(source_record: FoodSourceRecord, db: Session) -> None:
    """Keep the stale snapshot available and defer the next provider attempt."""
    now = datetime.now(timezone.utc)
    current_failures = db.scalar(
        select(FoodSourceRecord.refresh_failure_count).where(FoodSourceRecord.id == source_record.id)
    )
    failure_count = max(0, int(current_failures or 0)) + 1
    retry_at = now + timedelta(
        seconds=refresh_retry_delay_seconds(source_record.id, failure_count)
    )
    db.execute(
        update(FoodSourceRecord)
        .execution_options(synchronize_session=False)
        .where(FoodSourceRecord.id == source_record.id)
        .values(
            refresh_attempted_at=now,
            refresh_not_before=retry_at,
            refresh_failure_count=failure_count,
            updated_at=now,
        )
    )
    db.commit()
    db.refresh(source_record)


async def refresh_stale_source_record(
    source_record: FoodSourceRecord,
    db: Session,
    registry: NutritionProviderRegistry,
    *,
    operation: str = "detail",
) -> FoodSourceRecord:
    if (
        source_record.provider == ProviderName.user
        or not source_record.retrieved_at
        or not retrieved_at_is_stale(source_record.retrieved_at)
    ):
        return source_record

    if not acquire_stale_source_refresh(source_record, db):
        metrics.record_food_cache_event(
            cache="source_record", operation=operation, outcome="refresh_deferred"
        )
        return source_record

    try:
        fresh_result = await registry.get_food_by_id(
            f"{source_record.provider}:{source_record.external_id}"
        )
    except Exception:
        record_stale_source_refresh_failure(source_record, db)
        metrics.record_food_cache_event(
            cache="source_record", operation=operation, outcome="refresh_failed"
        )
        return source_record

    if not fresh_result:
        record_stale_source_refresh_failure(source_record, db)
        metrics.record_food_cache_event(
            cache="source_record", operation=operation, outcome="refresh_no_match"
        )
        return source_record

    refreshed_record = cache_food_result(db, fresh_result)
    db.commit()
    db.refresh(refreshed_record)
    metrics.record_food_cache_event(
        cache="source_record", operation=operation, outcome="refresh_succeeded"
    )
    return refreshed_record


async def refresh_stale_barcode_record(
    source_record: FoodSourceRecord,
    barcode: str,
    db: Session,
    registry: NutritionProviderRegistry,
) -> FoodSourceRecord:
    """Refresh only an exact stale barcode match; keep a flagged cached snapshot on failure."""
    if not cached_record_requires_refresh(source_record):
        return source_record

    if not acquire_stale_source_refresh(source_record, db):
        metrics.record_food_cache_event(
            cache="source_record", operation="barcode", outcome="refresh_deferred"
        )
        return source_record

    try:
        fresh_result = await registry.get_food_by_barcode(barcode)
    except Exception:
        record_stale_source_refresh_failure(source_record, db)
        metrics.record_food_cache_event(
            cache="source_record", operation="barcode", outcome="refresh_failed"
        )
        return source_record

    if (
        not fresh_result
        or fresh_result.provider != source_record.provider
        or fresh_result.external_id != source_record.external_id
    ):
        record_stale_source_refresh_failure(source_record, db)
        metrics.record_food_cache_event(
            cache="source_record", operation="barcode", outcome="refresh_no_match"
        )
        return source_record

    refreshed_record = cache_food_result(db, fresh_result)
    db.commit()
    db.refresh(refreshed_record)
    metrics.record_food_cache_event(
        cache="source_record", operation="barcode", outcome="refresh_succeeded"
    )
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


def get_accessible_food_source_record(
    food_id: str,
    db: Session,
    user_id: str,
) -> FoodSourceRecord | None:
    """Return a global provider record or a custom record owned by this account."""

    source_record = get_stored_food_source_record(food_id, db)

    if not source_record or source_record.provider != ProviderName.user:
        return source_record

    return db.scalar(
        select(FoodSourceRecord)
        .join(CustomFood, CustomFood.food_source_record_id == FoodSourceRecord.id)
        .where(
            FoodSourceRecord.id == source_record.id,
            CustomFood.user_id == user_id,
        )
    )


def raise_inaccessible_custom_food_or_404(
    food_id: str,
    db: Session,
    user_id: str,
    *,
    request: Request,
) -> None:
    """Record an owner denial only when a private custom record truly exists."""

    source_record = get_stored_food_source_record(food_id, db)
    if source_record and source_record.provider == ProviderName.user:
        raise_owner_scoped_not_found(
            db,
            request=request,
            user_id=user_id,
            detail="Food record not found.",
        )


def is_user_food_identifier(food_id: str) -> bool:
    return food_id.partition(":")[0] == ProviderName.user


def get_owned_custom_food_or_404(
    food_id: str,
    db: Session,
    user_id: str,
    *,
    request: Request | None = None,
) -> tuple[FoodSourceRecord, CustomFood]:
    source_record = get_stored_food_source_record(food_id, db)

    if not source_record:
        if request:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=user_id,
                detail="Custom food not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom food not found.")

    custom_food = db.scalar(
        select(CustomFood).where(
            CustomFood.user_id == user_id,
            CustomFood.food_source_record_id == source_record.id,
        )
    )

    if not custom_food:
        if request:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=user_id,
                detail="Custom food not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom food not found.")

    return source_record, custom_food


async def resolve_food_source_record(
    food_id: str,
    db: Session,
    registry: NutritionProviderRegistry,
    user_id: str,
) -> FoodSourceRecord | None:
    stored_record = get_accessible_food_source_record(food_id, db, user_id)

    if stored_record:
        return stored_record

    # A stored but inaccessible custom food belongs to another account. The
    # same 404-style outcome is used for an unknown record to avoid enumeration.
    if is_user_food_identifier(food_id) or get_stored_food_source_record(food_id, db):
        return None

    result = await registry.get_food_by_id(food_id)

    if not result or result.provider == ProviderName.user:
        return None

    return cache_food_result(db, result)


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
        **result.model_dump(exclude={"quality_assessment"}),
        quality_assessment=quality_assessment_for(result.provider, result.quality_flags),
        serving_options=serving_options,
        provenance_summary=(
            f"{result.provider} {result.data_type} record retrieved at "
            f"{result.retrieved_at.isoformat()}."
        ),
        retrieval_history=[],
    )


def food_detail_from_record(record: FoodSourceRecord, db: Session) -> FoodDetail:
    detail = food_detail_from_result(food_result_from_record(record))
    source_conflicts = food_source_conflict_history(record, db)
    quality_flags = list(detail.quality_flags)
    if any(conflict.is_current_conflict for conflict in source_conflicts):
        quality_flags = list(dict.fromkeys([*quality_flags, DUPLICATE_NUTRITION_CONFLICT_FLAG]))
    return detail.model_copy(
        update={
            "quality_flags": quality_flags,
            "quality_assessment": quality_assessment_for(record.provider, quality_flags),
            "retrieval_history": food_source_retrieval_history(record.id, db),
            "source_conflicts": source_conflicts,
        }
    )


def food_source_conflict_history(
    record: FoodSourceRecord,
    db: Session,
    limit: int = 5,
) -> list[FoodSourceConflictRead]:
    conflicts = db.scalars(
        select(FoodSourceConflict)
        .where(
            or_(
                FoodSourceConflict.first_food_source_record_id == record.id,
                FoodSourceConflict.second_food_source_record_id == record.id,
            )
        )
        .order_by(FoodSourceConflict.last_detected_at.desc())
        .limit(limit)
    ).all()
    counterpart_ids = {
        conflict.second_food_source_record_id
        if conflict.first_food_source_record_id == record.id
        else conflict.first_food_source_record_id
        for conflict in conflicts
    }
    counterparts = {
        candidate.id: candidate
        for candidate in db.scalars(
            select(FoodSourceRecord).where(FoodSourceRecord.id.in_(counterpart_ids))
        ).all()
    }

    history: list[FoodSourceConflictRead] = []
    for conflict in conflicts:
        counterpart_id = (
            conflict.second_food_source_record_id
            if conflict.first_food_source_record_id == record.id
            else conflict.first_food_source_record_id
        )
        counterpart = counterparts.get(counterpart_id)
        if not counterpart:
            continue
        history.append(
            FoodSourceConflictRead(
                conflicting_provider=ProviderName(counterpart.provider),
                conflicting_external_id=counterpart.external_id,
                conflicting_display_name=counterpart.display_name,
                conflict_type=conflict.conflict_type,
                evidence=conflict.evidence_json or {},
                first_detected_at=conflict.first_detected_at,
                last_detected_at=conflict.last_detected_at,
                is_current_conflict=records_currently_conflict(record, counterpart),
            )
        )
    return history


def food_source_retrieval_history(
    food_source_record_id: str,
    db: Session,
    limit: int = 5,
) -> list[FoodSourceRevisionRead]:
    revisions = db.scalars(
        select(FoodSourceRevision)
        .where(FoodSourceRevision.food_source_record_id == food_source_record_id)
        .order_by(FoodSourceRevision.source_retrieved_at.desc())
        .limit(limit)
    ).all()

    return [
        FoodSourceRevisionRead(
            display_name=revision.display_name,
            data_type=revision.data_type,
            brand_owner=revision.brand_owner,
            publication_date=revision.publication_date,
            nutrients_per_100g=NutrientsPer100g.model_validate(revision.nutrients_per_100g),
            serving_size=revision.serving_size,
            serving_size_unit=revision.serving_size_unit,
            household_serving_text=revision.household_serving_text,
            quality_flags=revision.quality_flags or [],
            source_reference=revision.source_reference,
            source_retrieved_at=revision.source_retrieved_at,
        )
        for revision in revisions
    ]


def food_result_from_record(
    record: FoodSourceRecord,
    *,
    saved_tags: list[str] | None = None,
) -> FoodSearchResult:
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
        saved_tags=saved_tags or [],
    )


def favorite_tags_by_favorite_id(
    db: Session,
    user_id: str,
    favorite_ids: list[str],
) -> dict[str, list[str]]:
    """Return tags without attaching user-specific state to source food records."""

    if not favorite_ids:
        return {}

    rows = db.execute(
        select(FavoriteFoodTagAssignment.favorite_food_id, FavoriteFoodTag.name)
        .join(
            FavoriteFoodTag,
            FavoriteFoodTag.id == FavoriteFoodTagAssignment.favorite_food_tag_id,
        )
        .join(FavoriteFood, FavoriteFood.id == FavoriteFoodTagAssignment.favorite_food_id)
        .where(
            FavoriteFood.user_id == user_id,
            FavoriteFoodTagAssignment.favorite_food_id.in_(favorite_ids),
        )
        .order_by(FavoriteFoodTag.name.asc())
    ).all()
    tags_by_favorite_id: dict[str, list[str]] = {favorite_id: [] for favorite_id in favorite_ids}
    for favorite_id, name in rows:
        tags_by_favorite_id.setdefault(favorite_id, []).append(name)
    return tags_by_favorite_id


def quality_assessment_for(
    provider: ProviderName | str,
    quality_flags: list[str],
) -> FoodQualityAssessment:
    return FoodQualityAssessment.model_validate(
        assess_food_quality(str(provider), quality_flags).as_dict()
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
