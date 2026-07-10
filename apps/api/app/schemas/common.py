from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ConfidenceTier(StrEnum):
    verified = "verified"
    high = "high"
    medium = "medium"
    low = "low"


class NutrientsPer100g(ApiModel):
    calories_kcal: float = Field(ge=0)
    protein_grams: float = Field(ge=0)
    carbohydrate_grams: float = Field(ge=0)
    fat_grams: float = Field(ge=0)
    fiber_grams: float | None = Field(default=None, ge=0)
    sugar_grams: float | None = Field(default=None, ge=0)
    sodium_milligrams: float | None = Field(default=None, ge=0)


class ConfidenceBreakdown(ApiModel):
    identity: ConfidenceTier
    portion: ConfidenceTier
    nutrition_record: ConfidenceTier
    explanation: str
