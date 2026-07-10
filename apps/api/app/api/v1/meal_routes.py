from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session, selectinload

from app.core.auth import CurrentUser, ensure_current_user
from app.db.session import get_db
from app.models.food import FoodSourceRecord
from app.models.meal import Meal, MealItem
from app.models.user import RecentFood
from app.schemas.meal import MealCreate, MealItemCreate, MealItemRead, MealRead, MealUpdate

router = APIRouter()


@router.post("", response_model=MealRead, status_code=status.HTTP_201_CREATED)
def create_meal(
    meal: MealCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> MealRead:
    persisted_meal = Meal(
        user_id=current_user.id,
        name=meal.name,
        logged_at=meal.logged_at or datetime.now(UTC),
        notes=meal.notes,
    )

    append_meal_items(persisted_meal, meal.items)
    upsert_recent_foods(db, current_user.id, meal.items)

    db.add(persisted_meal)
    db.commit()

    return meal_to_read(get_meal_or_404(db, persisted_meal.id, current_user.id))


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
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> MealRead:
    return meal_to_read(get_meal_or_404(db, meal_id, current_user.id))


@router.patch("/{meal_id}", response_model=MealRead)
def update_meal(
    meal_id: str,
    meal_update: MealUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> MealRead:
    meal = get_meal_or_404(db, meal_id, current_user.id)
    update_data = meal_update.model_dump(exclude_unset=True)

    if "name" in update_data and update_data["name"] is not None:
        meal.name = update_data["name"]

    if "notes" in update_data:
        meal.notes = update_data["notes"]

    if meal_update.items is not None:
        meal.items.clear()
        append_meal_items(meal, meal_update.items)
        upsert_recent_foods(db, current_user.id, meal_update.items)

    db.commit()
    return meal_to_read(get_meal_or_404(db, meal_id, current_user.id))


@router.delete("/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(
    meal_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    meal = get_meal_or_404(db, meal_id, current_user.id)
    db.delete(meal)
    db.commit()


def meal_query(user_id: str) -> Select[tuple[Meal]]:
    return (
        select(Meal)
        .options(selectinload(Meal.items))
        .where(Meal.user_id == user_id)
    )


def get_meal_or_404(db: Session, meal_id: str, user_id: str) -> Meal:
    meal = db.scalar(meal_query(user_id).where(Meal.id == meal_id))

    if not meal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found.")

    return meal


def meal_to_read(meal: Meal) -> MealRead:
    return MealRead(
        id=meal.id,
        name=meal.name,
        logged_at=meal.logged_at,
        notes=meal.notes,
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


def append_meal_items(meal: Meal, items: list[MealItemCreate]) -> None:
    for item in items:
        meal.items.append(
            MealItem(
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

        recent = db.scalar(
            select(RecentFood).where(
                RecentFood.user_id == user_id,
                RecentFood.food_source_record_id == source_record.id,
            )
        )

        if recent:
            recent.last_used_at = now
            recent.use_count += 1
        else:
            db.add(
                RecentFood(
                    user_id=user_id,
                    food_source_record_id=source_record.id,
                    last_used_at=now,
                    use_count=1,
                )
            )


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
