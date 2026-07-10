from datetime import date, datetime, timezone
from enum import StrEnum

from pydantic import Field

from app.schemas.common import ApiModel, ConfidenceTier, NutrientsPer100g


class ProviderName(StrEnum):
    usda = "usda"
    open_food_facts = "open_food_facts"
    commercial = "commercial"
    user = "user"


class LabelNutritionBasis(StrEnum):
    per_serving = "per_serving"
    per_100g = "per_100g"
    unknown = "unknown"


class FoodSearchResult(ApiModel):
    id: str
    display_name: str
    provider: ProviderName
    external_id: str
    data_type: str
    brand_owner: str | None = None
    publication_date: date | None = None
    serving_size: float | None = Field(default=None, ge=0)
    serving_size_unit: str | None = None
    household_serving_text: str | None = None
    nutrients_per_100g: NutrientsPer100g
    original_nutrient_ids: dict[str, str] = Field(default_factory=dict)
    quality_flags: list[str] = Field(default_factory=list)
    record_confidence: ConfidenceTier
    source_reference: str
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FoodSearchResponse(ApiModel):
    items: list[FoodSearchResult]


class FoodServingOption(ApiModel):
    label: str
    quantity: float
    unit: str
    grams: float | None = None
    milliliters: float | None = None


class FoodDetail(FoodSearchResult):
    serving_options: list[FoodServingOption] = Field(default_factory=list)
    provenance_summary: str


class CustomFoodCreate(ApiModel):
    display_name: str = Field(min_length=1, max_length=512)
    barcode: str | None = None
    brand_owner: str | None = None
    serving_size: float | None = Field(default=None, ge=0)
    serving_size_unit: str | None = None
    household_serving_text: str | None = None
    nutrients_per_100g: NutrientsPer100g
    notes: str | None = None


class NutritionLabelAnalysisRequest(ApiModel):
    image_base64: str = Field(min_length=16, max_length=20_000_000)
    barcode: str | None = Field(default=None, max_length=64)


class LabelNutrients(ApiModel):
    calories_kcal: float | None = Field(default=None, ge=0)
    protein_grams: float | None = Field(default=None, ge=0)
    carbohydrate_grams: float | None = Field(default=None, ge=0)
    fat_grams: float | None = Field(default=None, ge=0)
    fiber_grams: float | None = Field(default=None, ge=0)
    sugar_grams: float | None = Field(default=None, ge=0)
    sodium_milligrams: float | None = Field(default=None, ge=0)


class NutritionLabelAnalysis(ApiModel):
    display_name: str | None = None
    brand_owner: str | None = None
    barcode: str | None = None
    serving_size_text: str | None = None
    serving_size_grams: float | None = Field(default=None, gt=0)
    nutrition_basis: LabelNutritionBasis
    label_nutrients: LabelNutrients
    nutrients_per_100g: NutrientsPer100g | None = None
    confidence: ConfidenceTier
    quality_flags: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    requires_confirmation: bool = True


class FoodCorrectionReportCreate(ApiModel):
    report_type: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=8, max_length=2000)


class FoodCorrectionReportRead(ApiModel):
    id: str
    food_source_record_id: str | None
    report_type: str
    message: str
    status: str
    created_at: datetime


class FoodCorrectionReportSummary(FoodCorrectionReportRead):
    source_display_name: str | None = None
    source_provider: ProviderName | None = None
    source_external_id: str | None = None
    source_reference: str | None = None


class FoodCorrectionReportList(ApiModel):
    items: list[FoodCorrectionReportSummary]
