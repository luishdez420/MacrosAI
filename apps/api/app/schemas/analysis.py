from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated
from uuid import uuid4

from pydantic import Field, model_validator

from app.schemas.common import ApiModel, ConfidenceBreakdown, NutrientsPer100g
from app.schemas.food import FoodQualityAssessment, FoodSearchResult, ProviderName


# Keep encoded request bodies bounded before image decoding. The sanitizer
# independently validates decoded bytes, signatures, pixel count, and metadata.
MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS = 16 * 1024 * 1024 + 1024
MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS = 24 * 1024 * 1024 + 3 * 1024
Base64Image = Annotated[str, Field(min_length=16, max_length=MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS)]


class MealAnalysisStatus(StrEnum):
    ready = "ready"
    needs_review = "needs_review"


class AnalysisJobStatus(StrEnum):
    queued = "queued"
    processing = "processing"
    needs_review = "needs_review"
    failed = "failed"
    cancelled = "cancelled"
    expired = "expired"


class PortionRangeGrams(ApiModel):
    minimum: float = Field(ge=0)
    maximum: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_order(self) -> "PortionRangeGrams":
        if self.maximum < self.minimum:
            raise ValueError("portionRangeGrams maximum must be greater than or equal to minimum.")
        return self


class ViewEvidenceStatus(StrEnum):
    single_view = "single_view"
    corroborated = "corroborated"
    conflicting = "conflicting"
    unavailable = "unavailable"


class CandidateViewEvidence(ApiModel):
    """Review-only view support for a candidate food label.

    The indexes identify submitted views where the scan saw a matching visible
    cue. They are not a statement that the food identity is verified.
    """

    label: str = Field(min_length=1)
    observed_in_view_indexes: list[int] = Field(default_factory=list)


class ViewEvidence(ApiModel):
    status: ViewEvidenceStatus
    observed_in_view_indexes: list[int] = Field(default_factory=list)
    candidate_evidence: list[CandidateViewEvidence] = Field(default_factory=list)
    explanation: str


def default_view_evidence() -> ViewEvidence:
    """Keep older persisted review jobs readable after view evidence was added."""

    return ViewEvidence(
        status=ViewEvidenceStatus.unavailable,
        explanation="Per-view scan evidence was not recorded. Confirm or replace this food before logging.",
    )


class MealAnalysisRequest(ApiModel):
    # ``image_base64`` remains for older mobile clients. New clients may send
    # up to three complementary views of the same meal in ``images_base64``.
    image_base64: Base64Image | None = None
    images_base64: list[Base64Image] = Field(default_factory=list, max_length=3)
    # Optional visual scale cue. It never substitutes for the user's gram confirmation.
    reference_plate_diameter_mm: float | None = Field(default=None, ge=100, le=500)
    idempotency_key: str | None = None

    @model_validator(mode="after")
    def validate_images(self) -> "MealAnalysisRequest":
        if not self.images_base64 and not self.image_base64:
            raise ValueError("Provide imageBase64 or at least one imagesBase64 value.")
        if sum(len(image) for image in self.images_base64) > MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS:
            raise ValueError("Meal images are too large. Use up to three photos totaling 18 MB or less.")
        return self

    @property
    def analysis_images(self) -> list[str]:
        return self.images_base64 or ([self.image_base64] if self.image_base64 else [])


class MealAnalysisJobCreateRequest(MealAnalysisRequest):
    """Creates a durable, review-only analysis job from one to three photos."""

    pass


class MealAnalysisItem(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    detected_name: str
    candidate_labels: list[str] = Field(default_factory=list)
    # These are bounded provider-record alternatives for uncertain scan labels, not AI nutrition guesses.
    candidate_foods: list[FoodSearchResult] = Field(default_factory=list, max_length=3)
    display_name: str
    provider: ProviderName
    external_id: str
    data_type: str
    source_reference: str
    quality_assessment: FoodQualityAssessment | None = None
    serving_grams: float = Field(ge=0)
    serving_label: str
    portion_range_grams: PortionRangeGrams
    visible_preparation: str = "not_sure"
    possible_hidden_ingredients: list[str] = Field(default_factory=list)
    view_evidence: ViewEvidence = Field(default_factory=default_view_evidence)
    nutrients: NutrientsPer100g
    confidence: ConfidenceBreakdown
    needs_review: bool
    notes: str = ""


class MealAnalysisResult(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    status: MealAnalysisStatus
    meal_name: str
    summary: str
    notes: str = ""
    image_count: int = Field(default=1, ge=1, le=3)
    reference_plate_diameter_mm: float | None = Field(default=None, ge=100, le=500)
    total_nutrients: NutrientsPer100g
    items: list[MealAnalysisItem]
    confidence: ConfidenceBreakdown
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AnalysisJobResponse(ApiModel):
    """Safe owner-facing state for a durable analysis request.

    This intentionally omits storage keys, provider request IDs, raw errors, and
    submitted images. A result is always review-only and never a logged meal.
    """

    id: str
    status: AnalysisJobStatus
    image_count: int = Field(ge=0, le=3)
    attempt_count: int = Field(ge=0)
    created_at: datetime
    expires_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    result: MealAnalysisResult | None = None
    error_code: str | None = None
