from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import ApiModel
from app.schemas.meal import MealItemCreate, MealItemRead, MealRead, MealType


class RecipeCreate(ApiModel):
    name: str = Field(min_length=1, max_length=256)
    meal_type: MealType = MealType.meal
    notes: str | None = None
    folder_id: str | None = None
    is_favorite: bool = False
    items: list[MealItemCreate] = Field(min_length=1)


class RecipeUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    meal_type: MealType | None = None
    notes: str | None = None
    folder_id: str | None = None
    # A default preserves PATCH omission semantics through model_fields_set,
    # while rejecting an explicit null instead of silently treating it as false.
    is_favorite: bool = False
    items: list[MealItemCreate] | None = Field(default=None, min_length=1)


class RecipeTagsUpdate(ApiModel):
    tags: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, tags: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for tag in tags:
            value = " ".join(tag.split())
            if not value or len(value) > 48:
                raise ValueError("Each tag must contain between 1 and 48 characters.")
            key = value.casefold()
            if key not in seen:
                normalized.append(value)
                seen.add(key)
        return normalized


class RecipeFolderCreate(ApiModel):
    name: str = Field(min_length=1, max_length=64)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, name: str) -> str:
        normalized = " ".join(name.split())
        if not normalized:
            raise ValueError("Folder name must contain visible characters.")
        return normalized


class RecipeFolderUpdate(RecipeFolderCreate):
    pass


class RecipeFolderRead(ApiModel):
    id: str
    name: str
    created_at: datetime


class RecipeRead(ApiModel):
    id: str
    name: str
    meal_type: MealType = MealType.meal
    notes: str | None = None
    times_used: int
    is_favorite: bool = False
    folder_id: str | None = None
    folder_name: str | None = None
    tags: list[str] = Field(default_factory=list)
    items: list[MealItemRead]
    created_at: datetime
    updated_at: datetime


class RecipeLogResult(ApiModel):
    recipe: RecipeRead
    meal: MealRead
