from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.v1.meal_routes import meal_to_read, upsert_recent_foods
from app.core.auth import CurrentUser, ensure_current_user
from app.core.authorization import raise_owner_scoped_not_found
from app.core.idempotency import (
    RECIPE_CREATE_OPERATION,
    RECIPE_LOG_OPERATION,
    complete_idempotency_key,
    get_completed_replay,
    reserve_idempotency_key,
    resolve_idempotency_key,
)
from app.db.session import get_db
from app.models.meal import Meal, MealItem
from app.models.recipe import Recipe, RecipeFolder, RecipeItem, RecipeTag, RecipeTagAssignment
from app.schemas.meal import MealItemCreate, MealItemRead
from app.schemas.recipe import (
    RecipeCreate,
    RecipeFolderCreate,
    RecipeFolderRead,
    RecipeFolderUpdate,
    RecipeLogResult,
    RecipeRead,
    RecipeTagsUpdate,
    RecipeUpdate,
)

router = APIRouter()


@router.post("", response_model=RecipeRead, status_code=status.HTTP_201_CREATED)
def create_recipe(
    recipe: RecipeCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> RecipeRead:
    resolved_key = resolve_idempotency_key(idempotency_key)
    request_payload = recipe.model_dump(mode="json")
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=RECIPE_CREATE_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
        commit=False,
    )
    if reservation and reservation.is_replay:
        return RecipeRead.model_validate(reservation.replay_body)

    persisted = Recipe(
        user_id=current_user.id,
        name=recipe.name,
        meal_type=recipe.meal_type.value,
        notes=recipe.notes,
        folder_id=resolve_recipe_folder_id(db, recipe.folder_id, current_user.id),
        is_favorite=recipe.is_favorite,
    )
    append_recipe_items(persisted, recipe.items)
    db.add(persisted)
    try:
        db.flush()
        response = recipe_to_read(get_recipe_or_404(db, persisted.id, current_user.id))
        complete_idempotency_key(
            db,
            reservation,
            response,
            response_status=status.HTTP_201_CREATED,
            resource_type="recipe",
            resource_id=persisted.id,
            commit=False,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = get_completed_replay(
            db,
            user_id=current_user.id,
            operation=RECIPE_CREATE_OPERATION,
            idempotency_key=resolved_key,
            request_payload=request_payload,
        )
        if replay:
            return RecipeRead.model_validate(replay)
        raise

    return response


@router.get("", response_model=list[RecipeRead])
def list_recipes(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> list[RecipeRead]:
    recipes = db.scalars(recipe_query(current_user.id).order_by(Recipe.updated_at.desc())).all()
    tags = recipe_tags_by_recipe_id(db, current_user.id, [recipe.id for recipe in recipes])
    return [recipe_to_read(recipe, tags.get(recipe.id, [])) for recipe in recipes]


@router.get("/folders", response_model=list[RecipeFolderRead])
def list_recipe_folders(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> list[RecipeFolderRead]:
    folders = db.scalars(
        select(RecipeFolder)
        .where(RecipeFolder.user_id == current_user.id)
        .order_by(func.lower(RecipeFolder.name), RecipeFolder.created_at)
    ).all()
    return [recipe_folder_to_read(folder) for folder in folders]


@router.post("/folders", response_model=RecipeFolderRead, status_code=status.HTTP_201_CREATED)
def create_recipe_folder(
    folder_input: RecipeFolderCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RecipeFolderRead:
    existing = db.scalar(
        select(RecipeFolder).where(
            RecipeFolder.user_id == current_user.id,
            func.lower(RecipeFolder.name) == folder_input.name.lower(),
        )
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A folder with that name already exists.")

    folder = RecipeFolder(user_id=current_user.id, name=folder_input.name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return recipe_folder_to_read(folder)


@router.patch("/folders/{folder_id}", response_model=RecipeFolderRead)
def update_recipe_folder(
    folder_id: str,
    folder_input: RecipeFolderUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RecipeFolderRead:
    folder = get_recipe_folder_or_404(db, folder_id, current_user.id, request=request)
    duplicate = db.scalar(
        select(RecipeFolder).where(
            RecipeFolder.user_id == current_user.id,
            func.lower(RecipeFolder.name) == folder_input.name.lower(),
            RecipeFolder.id != folder.id,
        )
    )
    if duplicate:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A folder with that name already exists.")
    folder.name = folder_input.name
    db.commit()
    db.refresh(folder)
    return recipe_folder_to_read(folder)


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe_folder(
    folder_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    folder = get_recipe_folder_or_404(db, folder_id, current_user.id, request=request)
    # Folder cleanup only removes the organizational link. Recipes and their
    # source-backed snapshots remain available, as do meals previously logged.
    db.execute(
        update(Recipe)
        .where(Recipe.user_id == current_user.id, Recipe.folder_id == folder.id)
        .values(folder_id=None)
    )
    db.delete(folder)
    db.commit()


@router.get("/{recipe_id}", response_model=RecipeRead)
def get_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RecipeRead:
    recipe = get_recipe_or_404(db, recipe_id, current_user.id, request=request)
    tags = recipe_tags_by_recipe_id(db, current_user.id, [recipe.id])
    return recipe_to_read(recipe, tags.get(recipe.id, []))


@router.patch("/{recipe_id}", response_model=RecipeRead)
def update_recipe(
    recipe_id: str,
    recipe_update: RecipeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RecipeRead:
    recipe = get_recipe_or_404(db, recipe_id, current_user.id, request=request)
    if recipe_update.name is not None:
        recipe.name = recipe_update.name
    if recipe_update.meal_type is not None:
        recipe.meal_type = recipe_update.meal_type.value
    if "notes" in recipe_update.model_fields_set:
        recipe.notes = recipe_update.notes
    if "folder_id" in recipe_update.model_fields_set:
        recipe.folder_id = resolve_recipe_folder_id(db, recipe_update.folder_id, current_user.id, request=request)
    if "is_favorite" in recipe_update.model_fields_set:
        recipe.is_favorite = bool(recipe_update.is_favorite)
    if recipe_update.items is not None:
        recipe.items.clear()
        append_recipe_items(recipe, recipe_update.items)
    db.commit()
    persisted = get_recipe_or_404(db, recipe_id, current_user.id, request=request)
    tags = recipe_tags_by_recipe_id(db, current_user.id, [persisted.id])
    return recipe_to_read(persisted, tags.get(persisted.id, []))


@router.put("/{recipe_id}/tags", response_model=RecipeRead)
def replace_recipe_tags(
    recipe_id: str,
    tag_update: RecipeTagsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> RecipeRead:
    """Replace private organization tags without changing recipe snapshots."""
    recipe = get_recipe_or_404(db, recipe_id, current_user.id, request=request)
    requested = tag_update.tags
    existing = db.scalars(select(RecipeTag).where(
        RecipeTag.user_id == current_user.id,
        func.lower(RecipeTag.name).in_([tag.lower() for tag in requested]),
    )).all() if requested else []
    by_name = {tag.name.casefold(): tag for tag in existing}
    resolved: list[RecipeTag] = []
    for name in requested:
        tag = by_name.get(name.casefold())
        if tag is None:
            tag = RecipeTag(user_id=current_user.id, name=name)
            db.add(tag)
            db.flush()
            by_name[name.casefold()] = tag
        resolved.append(tag)
    db.execute(delete(RecipeTagAssignment).where(RecipeTagAssignment.recipe_id == recipe.id))
    db.add_all(RecipeTagAssignment(recipe_id=recipe.id, recipe_tag_id=tag.id) for tag in resolved)
    db.commit()
    return recipe_to_read(recipe, [tag.name for tag in resolved])


@router.delete("/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
) -> None:
    db.delete(get_recipe_or_404(db, recipe_id, current_user.id, request=request))
    db.commit()


@router.post("/{recipe_id}/log", response_model=RecipeLogResult, status_code=status.HTTP_201_CREATED)
def log_recipe(
    recipe_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(ensure_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> RecipeLogResult:
    recipe = get_recipe_or_404(db, recipe_id, current_user.id, request=request)
    resolved_key = resolve_idempotency_key(idempotency_key)
    request_payload = {"recipe_id": recipe_id}
    reservation = reserve_idempotency_key(
        db,
        user_id=current_user.id,
        operation=RECIPE_LOG_OPERATION,
        idempotency_key=resolved_key,
        request_payload=request_payload,
        commit=False,
    )
    if reservation and reservation.is_replay:
        return RecipeLogResult.model_validate(reservation.replay_body)

    logged_at = datetime.now(UTC)
    meal = Meal(
        user_id=current_user.id,
        name=recipe.name,
        meal_type=recipe.meal_type,
        notes=f"Logged from saved recipe: {recipe.name}. {recipe.notes or ''}".strip(),
        logged_at=logged_at,
    )
    item_creates = [recipe_item_to_create(item) for item in recipe.items]
    append_meal_items_from_recipe(meal, recipe.items)
    upsert_recent_foods(db, current_user.id, item_creates)
    recipe.times_used += 1
    db.add(meal)
    try:
        db.flush()
        persisted_recipe = get_recipe_or_404(db, recipe.id, current_user.id)
        persisted_meal = db.scalar(
            select(Meal)
            .options(selectinload(Meal.items))
            .where(Meal.id == meal.id, Meal.user_id == current_user.id)
        )
        if not persisted_meal:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Recipe meal was not saved.")

        tags = recipe_tags_by_recipe_id(db, current_user.id, [persisted_recipe.id])
        response = RecipeLogResult(
            recipe=recipe_to_read(persisted_recipe, tags.get(persisted_recipe.id, [])),
            meal=meal_to_read(persisted_meal),
        )
        complete_idempotency_key(
            db,
            reservation,
            response,
            response_status=status.HTTP_201_CREATED,
            resource_type="meal",
            resource_id=meal.id,
            commit=False,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = get_completed_replay(
            db,
            user_id=current_user.id,
            operation=RECIPE_LOG_OPERATION,
            idempotency_key=resolved_key,
            request_payload=request_payload,
        )
        if replay:
            return RecipeLogResult.model_validate(replay)
        raise

    return response


def recipe_query(user_id: str):
    return select(Recipe).options(selectinload(Recipe.items), selectinload(Recipe.folder)).where(Recipe.user_id == user_id)


def get_recipe_or_404(
    db: Session,
    recipe_id: str,
    user_id: str,
    *,
    request: Request | None = None,
) -> Recipe:
    recipe = db.scalar(recipe_query(user_id).where(Recipe.id == recipe_id))
    if not recipe:
        if request:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=user_id,
                detail="Recipe not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe not found.")
    return recipe


def get_recipe_folder_or_404(
    db: Session,
    folder_id: str,
    user_id: str,
    *,
    request: Request | None = None,
) -> RecipeFolder:
    folder = db.scalar(
        select(RecipeFolder).where(
            RecipeFolder.id == folder_id,
            RecipeFolder.user_id == user_id,
        )
    )
    if not folder:
        if request:
            raise_owner_scoped_not_found(
                db,
                request=request,
                user_id=user_id,
                detail="Recipe folder not found.",
            )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipe folder not found.")
    return folder


def resolve_recipe_folder_id(
    db: Session,
    folder_id: str | None,
    user_id: str,
    *,
    request: Request | None = None,
) -> str | None:
    if folder_id is None:
        return None
    return get_recipe_folder_or_404(db, folder_id, user_id, request=request).id


def append_recipe_items(recipe: Recipe, items: list[MealItemCreate]) -> None:
    for sort_order, item in enumerate(items):
        recipe.items.append(
            RecipeItem(
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


def append_meal_items_from_recipe(meal: Meal, items: list[RecipeItem]) -> None:
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
                identity_confidence=item.identity_confidence,
                portion_confidence=item.portion_confidence,
                nutrition_record_confidence=item.nutrition_record_confidence,
                confidence_explanation=item.confidence_explanation,
                user_confirmed=item.user_confirmed,
                preparation_method=item.preparation_method,
                added_oil_grams=item.added_oil_grams,
                notes=item.notes,
                nutrient_snapshot_json=item.nutrient_snapshot_json,
            )
        )


def recipe_item_to_create(item: RecipeItem) -> MealItemCreate:
    return MealItemCreate(
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
    )


def recipe_tags_by_recipe_id(db: Session, user_id: str, recipe_ids: list[str]) -> dict[str, list[str]]:
    if not recipe_ids:
        return {}
    rows = db.execute(
        select(RecipeTagAssignment.recipe_id, RecipeTag.name)
        .join(RecipeTag, RecipeTag.id == RecipeTagAssignment.recipe_tag_id)
        .join(Recipe, Recipe.id == RecipeTagAssignment.recipe_id)
        .where(Recipe.user_id == user_id, RecipeTagAssignment.recipe_id.in_(recipe_ids))
        .order_by(RecipeTag.name.asc())
    ).all()
    tags = {recipe_id: [] for recipe_id in recipe_ids}
    for recipe_id, name in rows:
        tags[recipe_id].append(name)
    return tags


def recipe_to_read(recipe: Recipe, tags: list[str] | None = None) -> RecipeRead:
    return RecipeRead(
        id=recipe.id,
        name=recipe.name,
        meal_type=recipe.meal_type,
        notes=recipe.notes,
        times_used=recipe.times_used,
        is_favorite=recipe.is_favorite,
        folder_id=recipe.folder_id,
        folder_name=recipe.folder.name if recipe.folder else None,
        tags=tags or [],
        created_at=recipe.created_at,
        updated_at=recipe.updated_at,
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
            for item in recipe.items
        ],
    )


def recipe_folder_to_read(folder: RecipeFolder) -> RecipeFolderRead:
    return RecipeFolderRead(id=folder.id, name=folder.name, created_at=folder.created_at)
