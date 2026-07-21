from datetime import date, datetime, timezone
from enum import StrEnum

from pydantic import Field, model_validator

from app.nutrition.food_quality import assess_food_quality
from app.schemas.common import ApiModel, ConfidenceTier, NutrientsPer100g


# Mirrors the 12 MiB decoded-image cap enforced by the shared sanitizer while
# rejecting excessive request bodies before image decoding begins.
MAX_LABEL_IMAGE_BASE64_CHARACTERS = 16 * 1024 * 1024 + 1024


class ProviderName(StrEnum):
    usda = "usda"
    open_food_facts = "open_food_facts"
    commercial = "commercial"
    user = "user"


class LabelNutritionBasis(StrEnum):
    per_serving = "per_serving"
    per_100g = "per_100g"
    unknown = "unknown"


class FoodQualityStatus(StrEnum):
    complete = "complete"
    needs_review = "needs_review"
    insufficient_data = "insufficient_data"
    user_entered = "user_entered"


class FoodQualitySignal(StrEnum):
    provider_record = "provider_record"
    user_entered = "user_entered"
    stale_source = "stale_source"
    conflicting_data = "conflicting_data"
    incomplete_data = "incomplete_data"
    serving_basis_issue = "serving_basis_issue"
    validation_issue = "validation_issue"


class FoodQualityAssessment(ApiModel):
    status: FoodQualityStatus
    signals: list[FoodQualitySignal] = Field(default_factory=list)
    summary: str
    is_blocking: bool


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
    quality_assessment: FoodQualityAssessment | None = None
    source_reference: str
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def populate_quality_assessment(self) -> "FoodSearchResult":
        assessment = assess_food_quality(str(self.provider), self.quality_flags)
        self.quality_assessment = FoodQualityAssessment.model_validate(assessment.as_dict())

        # A failed essential-data check must never keep an inherited high or
        # verified confidence label merely because the provider was trusted.
        if assessment.is_blocking:
            self.record_confidence = ConfidenceTier.low
        return self


class FoodSearchResponse(ApiModel):
    items: list[FoodSearchResult]


class FoodServingOption(ApiModel):
    label: str
    quantity: float
    unit: str
    grams: float | None = None
    milliliters: float | None = None


class FoodSourceRevisionRead(ApiModel):
    display_name: str
    data_type: str
    brand_owner: str | None = None
    publication_date: date | None = None
    nutrients_per_100g: NutrientsPer100g
    serving_size: float | None = None
    serving_size_unit: str | None = None
    household_serving_text: str | None = None
    quality_flags: list[str] = Field(default_factory=list)
    source_reference: str
    source_retrieved_at: datetime


class FoodSourceConflictRead(ApiModel):
    conflicting_provider: ProviderName
    conflicting_external_id: str
    conflicting_display_name: str
    conflict_type: str
    evidence: dict[str, object] = Field(default_factory=dict)
    first_detected_at: datetime
    last_detected_at: datetime
    is_current_conflict: bool


class FoodDetail(FoodSearchResult):
    serving_options: list[FoodServingOption] = Field(default_factory=list)
    provenance_summary: str
    retrieval_history: list[FoodSourceRevisionRead] = Field(default_factory=list)
    source_conflicts: list[FoodSourceConflictRead] = Field(default_factory=list)


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
    image_base64: str = Field(min_length=16, max_length=MAX_LABEL_IMAGE_BASE64_CHARACTERS)
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


class FoodCorrectionReportStatusHistoryRead(ApiModel):
    status: str
    summary: str | None = None
    created_at: datetime


class FoodCorrectionReportRead(ApiModel):
    id: str
    food_source_record_id: str | None
    report_type: str
    message: str
    status: str
    resolution_summary: str | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    status_history: list[FoodCorrectionReportStatusHistoryRead] = Field(default_factory=list)


class FoodCorrectionReportSummary(FoodCorrectionReportRead):
    source_display_name: str | None = None
    source_provider: ProviderName | None = None
    source_external_id: str | None = None
    source_reference: str | None = None


class FoodCorrectionReportList(ApiModel):
    items: list[FoodCorrectionReportSummary]
