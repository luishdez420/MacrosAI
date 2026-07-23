from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy import Select, select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, selectinload

from app.core.auth import CurrentUser, ensure_current_user
from app.core.authorization import raise_owner_scoped_not_found
from app.core.config import settings
from app.core.idempotency import (
    MEAL_CREATE_OPERATION,
    complete_idempotency_key,
    get_completed_replay,
    reserve_idempotency_key,
    resolve_idempotency_key,
)
from app.db.session import get_db
from app.models.analysis import AnalysisJob
from app.models.food import FoodSourceRecord
from app.models.meal import Meal, MealItem
from app.models.user import RecentFood, UserPreference
from app.schemas.meal import (
    MealCreate,
    MealImageAccessRead,
    MealImageRead,
    MealItemCreate,
    MealItemRead,
    MealRead,
    MealUpdate,
)
from app.services.image_lifecycle import (
    copy_review_images_to_meal,
    delete_analysis_job_images,
    delete_image,
    get_owned_meal_image_or_none,
)
from app.storage import PrivateImageStorage, build_private_image_storage

router = APIRouter()


@router.post("", response_model=MealRead, status_code=status.HTTP_201_CREATED)
def create_meal(
    meal: MealCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> MealRead:
    normalized_idempotency_key = resolve_idempotency_key(idempotency_key)
    request_payload = meal.model_dump(mode="json")
    completed_replay = get_completed_replay(
        db,
        user_id=current_user.id,
        operation=MEAL_CREATE_OPERATION,
        idempotency_key=normalized_idempotency_key,
        request_payload=request_payload,
    )
    if completed_replay:
        return MealRead.model_validate(completed_replay)

    # Validate a referenced review job before reserving an idempotency record
    # or flushing a new meal. Owner-denial auditing commits independently, so
    # doing it after either write could accidentally persist a rejected meal.
    analysis_job = get_confirmable_analysis_job_or_404(
        db,
        meal=meal,
        current_user=current_user,
        request=request,
    )
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=MEAL_CREATE_OPERATION,
        idempotency_key=normalized_idempotency_key,
        request_payload=request_payload,
        commit=False,
    )

    if reservation and reservation.is_replay:
        return MealRead.model_validate(reservation.replay_body)

    persisted_meal = Meal(
        user_id=current_user.id,
        name=meal.name,
        idempotency_key=normalized_idempotency_key,
        meal_type=meal.meal_type.value,
        logged_at=meal.logged_at or datetime.now(UTC),
        notes=meal.notes,
    )

    append_meal_items(persisted_meal, meal.items)
    upsert_recent_foods(db, current_user.id, meal.items)

    db.add(persisted_meal)
    try:
        db.flush()
        persist_confirmed_analysis_images(
            db,
            storage=storage,
            current_user=current_user,
            meal=persisted_meal,
            meal_request=meal,
            analysis_job=analysis_job,
        )
        response = meal_to_read(get_meal_or_404(db, persisted_meal.id, current_user.id))
        complete_idempotency_key(
            db,
            reservation,
            response,
            response_status=status.HTTP_201_CREATED,
            resource_type="meal",
            resource_id=persisted_meal.id,
            commit=False,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = get_completed_replay(
            db,
            user_id=current_user.id,
            operation=MEAL_CREATE_OPERATION,
            idempotency_key=normalized_idempotency_key,
            request_payload=request_payload,
        )
        if replay:
            return MealRead.model_validate(replay)
        raise
    except HTTPException:
        db.rollback()
        raise
    except (OSError, ValueError) as error:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The meal was not saved because its private photo could not be stored. Try again without keeping the photo.",
        ) from error

    return response


@router.get("", response_model=list[MealRead])
def list_meals(
    logged_date: date | None = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> list[MealRead]:
    statement = meal_query(current_user.id)

    if logged_date:
        start_at, end_at = day_bounds(logged_date)
        statement = statement.where(Meal.logged_at >= start_at, Meal.logged_at < end_at)

    meals = db.scalars(statement.order_by(Meal.logged_at.desc())).all()
    return [meal_to_read(meal) for meal in meals]


@router.get("/{meal_id}", response_model=MealRead)
def get_meal(
    meal_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> MealRead:
    return meal_to_read(get_meal_or_404(db, meal_id, current_user.id, request=request))


@router.patch("/{meal_id}", response_model=MealRead)
def update_meal(
    meal_id: str,
    meal_update: MealUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> MealRead:
    meal = get_meal_or_404(db, meal_id, current_user.id, request=request)
    expected_revision = parse_meal_revision_precondition(if_match)

    # Claim the revision before mutating related items. The conditional update
    # makes concurrent stale editors fail safely instead of replacing data.
    claimed_revision = db.execute(
        update(Meal)
        .where(
            Meal.id == meal_id,
            Meal.user_id == current_user.id,
            Meal.revision == expected_revision,
        )
        .values(revision=Meal.revision + 1, updated_at=datetime.now(UTC))
    )
    if claimed_revision.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This meal changed on another device. Reload the latest meal before saving your edits.",
        )

    db.refresh(meal)
    update_data = meal_update.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] is not None:
        meal.name = update_data["name"]

    if "meal_type" in update_data and update_data["meal_type"] is not None:
        meal.meal_type = update_data["meal_type"].value

    if "logged_at" in update_data and update_data["logged_at"] is not None:
        meal.logged_at = update_data["logged_at"]

    if "notes" in update_data:
        meal.notes = update_data["notes"]

    if meal_update.items is not None:
        meal.items.clear()
        append_meal_items(meal, meal_update.items)
        upsert_recent_foods(db, current_user.id, meal_update.items)

    db.commit()
    return meal_to_read(get_meal_or_404(db, meal_id, current_user.id, request=request))


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> None:
    meal = get_meal_or_404(db, meal_id, current_user.id, request=request)
    if not all(delete_image(storage, image) for image in meal.images if image.deleted_at is None):
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The meal photo could not be deleted yet. We will retry securely before removing this meal.",
        )
    db.delete(meal)
    db.commit()


@router.get("/{meal_id}/images/{image_id}/access", response_model=MealImageAccessRead)
def get_meal_image_access(
    meal_id: str,
    image_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> MealImageAccessRead:
    get_meal_or_404(db, meal_id, current_user.id, request=request)
    image = get_owned_meal_image_or_none(db, user_id=current_user.id, image_id=image_id)
    if not image or image.meal_id != meal_id:
        raise_owner_scoped_not_found(
            db,
            request=request,
            user_id=current_user.id,
            detail="Meal image not found.",
        )
    try:
        url = storage.signed_read_url(
            image.storage_key,
            expires_in_seconds=settings.image_signed_url_seconds,
        )
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Private meal-photo access is unavailable in this environment.",
        ) from error
    return MealImageAccessRead(url=url, expires_in_seconds=settings.image_signed_url_seconds)


@router.delete("/{meal_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal_image(
    meal_id: str,
    image_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    storage: PrivateImageStorage = Depends(build_private_image_storage),
) -> None:
    get_meal_or_404(db, meal_id, current_user.id, request=request)
    image = get_owned_meal_image_or_none(db, user_id=current_user.id, image_id=image_id)
    if not image or image.meal_id != meal_id:
        raise_owner_scoped_not_found(
            db,
            request=request,
            user_id=current_user.id,
            detail="Meal image not found.",
        )
    if not delete_image(storage, image):
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The photo could not be deleted yet. We will retry securely.",
        )
    db.commit()


def meal_query(user_id: str) -> Select[tuple[Meal]]:
    return (
        select(Meal)
        .options(selectinload(Meal.items), selectinload(Meal.images))
        .where(Meal.user_id == user_id)
    )


def get_meal_or_404(
    db: Session,
    meal_id: str,
    user_id: str,
    *,
    request: Request | None = None,
) -> Meal:
    meal = db.scalar(meal_query(user_id).where(Meal.id == meal_id))

    if not meal:
        if request:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=user_id,
                detail="Meal not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found.")

    return meal


def meal_to_read(meal: Meal) -> MealRead:
    return MealRead(
        id=meal.id,
        revision=meal.revision,
        name=meal.name,
        meal_type=meal.meal_type,
        logged_at=meal.logged_at,
        notes=meal.notes,
        images=[
            MealImageRead(
                id=image.id,
                capture_angle=image.capture_angle,
                content_type=image.content_type,
                retention_deadline=image.retention_deadline,
                created_at=image.created_at,
            )
            for image in meal.images
            if image.deleted_at is None
        ],
        created_at=meal.created_at,
        updated_at=meal.updated_at,
        items=[
            MealItemRead(
                id=item.id,
                food_id=item.food_id,
                display_name=item.display_name,
                consumed_grams=item.consumed_grams,
                serving_quantity=item.serving_quantity,
                serving_unit=item.serving_unit,
                calories=item.calories,
                protein_grams=item.protein_grams,
                carbohydrate_grams=item.carbohydrate_grams,
                fat_grams=item.fat_grams,
                fiber_grams=item.fiber_grams,
                sugar_grams=item.sugar_grams,
                sodium_milligrams=item.sodium_milligrams,
                source_provider=item.source_provider,
                source_external_id=item.source_external_id,
                source_version=item.source_version,
                source_reference=item.source_reference,
                nutrient_snapshot_json=item.nutrient_snapshot_json,
                confidence={
                    "identity": item.identity_confidence,
                    "portion": item.portion_confidence,
                    "nutrition_record": item.nutrition_record_confidence,
                    "explanation": item.confidence_explanation,
                },
                user_confirmed=item.user_confirmed,
                preparation_method=item.preparation_method,
                added_oil_grams=item.added_oil_grams,
                notes=item.notes,
                created_at=item.created_at,
                updated_at=item.updated_at,
            )
            for item in meal.items
        ],
    )


def parse_meal_revision_precondition(if_match: str | None) -> int:
    """Read the single revision ETag accepted for saved-meal updates."""

    if not if_match:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="Reload this meal before saving changes.",
        )

    value = if_match.strip()
    if not (value.startswith('"') and value.endswith('"')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The meal revision is invalid. Reload the meal and try again.",
        )
    value = value[1:-1]

    if not value.isdigit() or int(value) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The meal revision is invalid. Reload the meal and try again.",
        )

    return int(value)


def persist_confirmed_analysis_images(
    db: Session,
    *,
    storage: PrivateImageStorage,
    current_user: CurrentUser,
    meal: Meal,
    meal_request: MealCreate,
    analysis_job: AnalysisJob | None,
) -> None:
    """Honor an explicit per-meal photo choice while retaining no scan by default."""

    if not meal_request.analysis_job_id:
        if meal_request.retain_analysis_images:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A completed camera analysis is required to keep a scan photo with a meal.",
            )
        return

    if not analysis_job:
        # This is unreachable after the preflight in create_meal. Retain a
        # defensive failure rather than allowing a scan reference to proceed.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal analysis was not found.")

    if meal_request.retain_analysis_images:
        preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
        retention_days = preferences.image_retention_days if preferences else settings.image_retention_days
        if retention_days <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Your photo-retention preference is set to delete immediately. Change it before keeping a meal photo.",
            )
        copy_review_images_to_meal(
            db,
            storage=storage,
            analysis_job=analysis_job,
            meal=meal,
            retention_deadline=datetime.now(UTC) + timedelta(days=retention_days),
        )

    # Whether or not a copy was requested, the temporary review inputs are no
    # longer needed once the user explicitly confirms this meal.
    delete_analysis_job_images(db, storage=storage, analysis_job_id=analysis_job.id)


def get_confirmable_analysis_job_or_404(
    db: Session,
    *,
    meal: MealCreate,
    current_user: CurrentUser,
    request: Request,
) -> AnalysisJob | None:
    """Resolve a review job before a meal transaction can write anything.

    The lookup is deliberately owner-scoped. A missing, expired, cancelled, or
    other-account job follows the same non-enumerating 404 policy as direct
    analysis-job reads and cancellations.
    """

    if not meal.analysis_job_id:
        return None

    job = db.scalar(
        select(AnalysisJob).where(
            AnalysisJob.id == meal.analysis_job_id,
            AnalysisJob.user_id == current_user.id,
            AnalysisJob.status == "needs_review",
            AnalysisJob.expires_at.is_not(None),
            AnalysisJob.expires_at > datetime.now(UTC),
        )
    )
    if job:
        return job

    raise_owner_scoped_not_found(
        db,
        request=request,
        user_id=current_user.id,
        detail="Meal analysis was not found.",
    )


def append_meal_items(meal: Meal, items: list[MealItemCreate]) -> None:
    for sort_order, item in enumerate(items):
        meal.items.append(
            MealItem(
                food_id=item.food_id,
                display_name=item.display_name,
                sort_order=sort_order,
                consumed_grams=item.consumed_grams,
                serving_quantity=item.serving_quantity,
                serving_unit=item.serving_unit,
                calories=item.calories,
                protein_grams=item.protein_grams,
                carbohydrate_grams=item.carbohydrate_grams,
                fat_grams=item.fat_grams,
                fiber_grams=item.fiber_grams,
                sugar_grams=item.sugar_grams,
                sodium_milligrams=item.sodium_milligrams,
                source_provider=item.source_provider,
                source_external_id=item.source_external_id,
                source_version=item.source_version,
                source_reference=item.source_reference,
                identity_confidence=item.confidence.identity,
                portion_confidence=item.confidence.portion,
                nutrition_record_confidence=item.confidence.nutrition_record,
                confidence_explanation=item.confidence.explanation,
                user_confirmed=item.user_confirmed,
                preparation_method=item.preparation_method,
                added_oil_grams=item.added_oil_grams,
                notes=item.notes,
                nutrient_snapshot_json=item.nutrient_snapshot_json,
            )
        )


def upsert_recent_foods(db: Session, user_id: str, items: list[MealItemCreate]) -> None:
    now = datetime.now(UTC)

    for item in items:
        source_record = get_or_create_food_source_record(db, item, now)

        if not source_record:
            continue

        insert = recent_food_insert_for(db)
        statement = insert(RecentFood).values(
            user_id=user_id,
            food_source_record_id=source_record.id,
            last_used_at=now,
            use_count=1,
        )
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["user_id", "food_source_record_id"],
                set_={
                    "last_used_at": now,
                    "use_count": RecentFood.use_count + 1,
                },
            )
        )


def recent_food_insert_for(db: Session):
    """Return the database-native atomic upsert builder for supported local/production stores."""

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        return postgresql_insert
    if dialect == "sqlite":
        return sqlite_insert
    raise RuntimeError(f"Recent-food upsert is not supported for database dialect: {dialect}")


def get_or_create_food_source_record(
    db: Session,
    item: MealItemCreate,
    retrieved_at: datetime,
) -> FoodSourceRecord | None:
    if not item.source_provider or not item.source_external_id:
        return None

    existing = db.scalar(
        select(FoodSourceRecord).where(
            FoodSourceRecord.provider == item.source_provider,
            FoodSourceRecord.external_id == item.source_external_id,
        )
    )

    if existing:
        return existing

    snapshot = item.nutrient_snapshot_json or {}
    nutrients_per_100g = snapshot_nutrients_per_100g(snapshot) or derive_nutrients_per_100g(item)
    original_nutrient_ids = snapshot.get("originalNutrientIds")
    quality_flags = snapshot.get("qualityFlags")

    source_record = FoodSourceRecord(
        provider=item.source_provider,
        external_id=item.source_external_id,
        display_name=item.display_name,
        data_type=item.source_version or "logged_food",
        brand_owner=snapshot.get("brandOwner") if isinstance(snapshot.get("brandOwner"), str) else None,
        publication_date=None,
        nutrients_per_100g=nutrients_per_100g,
        serving_size=item.consumed_grams if item.serving_unit == "grams" else None,
        serving_size_unit="g" if item.serving_unit == "grams" else None,
        household_serving_text=item.serving_unit,
        original_nutrient_ids=original_nutrient_ids if isinstance(original_nutrient_ids, dict) else {},
        quality_flags=quality_flags if isinstance(quality_flags, list) else [],
        source_reference=item.source_reference or "logged meal snapshot",
        retrieved_at=retrieved_at,
    )
    db.add(source_record)
    db.flush()

    return source_record


def snapshot_nutrients_per_100g(snapshot: dict) -> dict[str, float | None] | None:
    value = snapshot.get("nutrientsPer100g")

    if not isinstance(value, dict):
        return None

    required_keys = ["caloriesKcal", "proteinGrams", "carbohydrateGrams", "fatGrams"]

    if not all(isinstance(value.get(key), (int, float)) for key in required_keys):
        return None

    return {
        "caloriesKcal": float(value["caloriesKcal"]),
        "proteinGrams": float(value["proteinGrams"]),
        "carbohydrateGrams": float(value["carbohydrateGrams"]),
        "fatGrams": float(value["fatGrams"]),
        "fiberGrams": optional_float(value.get("fiberGrams")),
        "sugarGrams": optional_float(value.get("sugarGrams")),
        "sodiumMilligrams": optional_float(value.get("sodiumMilligrams")),
    }


def derive_nutrients_per_100g(item: MealItemCreate) -> dict[str, float | None]:
    scale = 100 / item.consumed_grams

    return {
        "caloriesKcal": item.calories * scale,
        "proteinGrams": item.protein_grams * scale,
        "carbohydrateGrams": item.carbohydrate_grams * scale,
        "fatGrams": item.fat_grams * scale,
        "fiberGrams": item.fiber_grams * scale if item.fiber_grams is not None else None,
        "sugarGrams": item.sugar_grams * scale if item.sugar_grams is not None else None,
        "sodiumMilligrams": item.sodium_milligrams * scale if item.sodium_milligrams is not None else None,
    }


def optional_float(value: object) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)

    return None


def day_bounds(value: date) -> tuple[datetime, datetime]:
    start = datetime.combine(value, time.min, tzinfo=UTC)
    end = start + timedelta(days=1)
    return start, end
