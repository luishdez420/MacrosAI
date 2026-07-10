from datetime import datetime, timezone
from enum import StrEnum
from uuid import uuid4

from pydantic import Field

from app.schemas.common import ApiModel, ConfidenceBreakdown, NutrientsPer100g
from app.schemas.food import ProviderName


class MealAnalysisStatus(StrEnum):
    ready = "ready"
    needs_review = "needs_review"


class MealAnalysisRequest(ApiModel):
    image_base64: str = Field(min_length=16)
    idempotency_key: str | None = None


class MealAnalysisItem(ApiModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    detected_name: str
    candidate_labels: list[str] = Field(default_factory=list)
    display_name: str
    provider: ProviderName
    external_id: str
    data_type: str
    source_reference: str
    serving_grams: float = Field(ge=0)
    serving_label: str
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
    total_nutrients: NutrientsPer100g
    items: list[MealAnalysisItem]
    confidence: ConfidenceBreakdown
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
