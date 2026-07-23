import json

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from app.analysis.meal_analyzer import (
    OPENAI_RESPONSES_URL,
    extract_response_text,
    sanitize_base64_image,
)
from app.core.config import settings
from app.nutrition.calculations import energy_is_consistent
from app.schemas.common import ConfidenceTier, NutrientsPer100g
from app.schemas.food import LabelNutrients, LabelNutritionBasis, NutritionLabelAnalysis


class RawNutritionLabelExtraction(BaseModel):
    display_name: str | None
    brand_owner: str | None
    serving_size_text: str | None
    serving_size_grams: float | None = Field(default=None, gt=0)
    nutrition_basis: LabelNutritionBasis
    calories_kcal: float | None = Field(default=None, ge=0)
    protein_grams: float | None = Field(default=None, ge=0)
    carbohydrate_grams: float | None = Field(default=None, ge=0)
    fat_grams: float | None = Field(default=None, ge=0)
    fiber_grams: float | None = Field(default=None, ge=0)
    sugar_grams: float | None = Field(default=None, ge=0)
    sodium_milligrams: float | None = Field(default=None, ge=0)
    confidence: ConfidenceTier
    warnings: list[str]


async def analyze_nutrition_label(
    image_base64: str,
    barcode: str | None = None,
    *,
    sanitized_image_base64: str | None = None,
) -> NutritionLabelAnalysis:
    if not settings.ai_features_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Nutrition-label analysis is unavailable in this free preview. "
                "Enter the label values manually instead."
            ),
        )

    # Route callers validate and normalize the image before reserving an AI
    # allowance. Keep the same validation here for direct callers, while
    # accepting that already-normalized value to avoid processing it twice.
    sanitized_image = sanitized_image_base64 or sanitize_base64_image(image_base64)

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is missing, so the nutrition label cannot be analyzed.",
        )

    try:
        async with httpx.AsyncClient(timeout=35) as client:
            response = await client.post(
                OPENAI_RESPONSES_URL,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=_request_payload(sanitized_image),
            )
    except httpx.TransportError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Nutrition label analysis could not reach the vision service. Try again.",
        ) from exc

    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Nutrition label analysis failed at the vision service "
                f"(HTTP {response.status_code}). Try again or enter values manually."
            ),
        )

    try:
        extraction = RawNutritionLabelExtraction.model_validate_json(
            extract_response_text(response.json())
        )
    except (ValidationError, json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "The nutrition label could not be read reliably. "
                "Retake the photo or enter values manually."
            ),
        ) from exc

    return normalize_label_extraction(extraction, barcode=barcode)


def normalize_label_extraction(
    extraction: RawNutritionLabelExtraction,
    *,
    barcode: str | None = None,
) -> NutritionLabelAnalysis:
    normalized_barcode = "".join(character for character in str(barcode or "") if character.isdigit())
    label_nutrients = LabelNutrients(
        calories_kcal=extraction.calories_kcal,
        protein_grams=extraction.protein_grams,
        carbohydrate_grams=extraction.carbohydrate_grams,
        fat_grams=extraction.fat_grams,
        fiber_grams=extraction.fiber_grams,
        sugar_grams=extraction.sugar_grams,
        sodium_milligrams=extraction.sodium_milligrams,
    )
    quality_flags: list[str] = []
    warnings = [warning.strip() for warning in extraction.warnings if warning.strip()]
    nutrients_per_100g = _normalize_per_100g(extraction)

    if not _has_core_nutrients(extraction):
        quality_flags.append("incomplete_label_nutrients")
        warnings.append("Some core calorie or macronutrient values were unreadable.")

    if (
        extraction.nutrition_basis == LabelNutritionBasis.per_serving
        and extraction.serving_size_grams is None
    ):
        quality_flags.append("missing_serving_grams")
        warnings.append(
            "The label serving has no verified gram weight, so per-100g values were not calculated."
        )

    if nutrients_per_100g is not None:
        if not energy_is_consistent(nutrients_per_100g, tolerance_ratio=0.25):
            quality_flags.append("energy_macro_mismatch")
            warnings.append("Calories and macronutrients do not closely agree; check the label.")
        if nutrients_per_100g.calories_kcal > 1500:
            quality_flags.append("possible_kj_confusion")
            warnings.append("The energy value may use kilojoules instead of kilocalories.")

    if nutrients_per_100g is None:
        quality_flags.append("per_100g_unavailable")

    warnings.append("All extracted values require comparison with the original label before saving.")

    return NutritionLabelAnalysis(
        display_name=_clean_optional_text(extraction.display_name),
        brand_owner=_clean_optional_text(extraction.brand_owner),
        barcode=normalized_barcode or None,
        serving_size_text=_clean_optional_text(extraction.serving_size_text),
        serving_size_grams=extraction.serving_size_grams,
        nutrition_basis=extraction.nutrition_basis,
        label_nutrients=label_nutrients,
        nutrients_per_100g=nutrients_per_100g,
        confidence=extraction.confidence,
        quality_flags=list(dict.fromkeys(quality_flags)),
        warnings=list(dict.fromkeys(warnings)),
        requires_confirmation=True,
    )


def _normalize_per_100g(
    extraction: RawNutritionLabelExtraction,
) -> NutrientsPer100g | None:
    if not _has_core_nutrients(extraction):
        return None

    if extraction.nutrition_basis == LabelNutritionBasis.per_100g:
        scale = 1.0
    elif (
        extraction.nutrition_basis == LabelNutritionBasis.per_serving
        and extraction.serving_size_grams
    ):
        scale = 100 / extraction.serving_size_grams
    else:
        return None

    return NutrientsPer100g(
        calories_kcal=round(extraction.calories_kcal * scale, 4),
        protein_grams=round(extraction.protein_grams * scale, 4),
        carbohydrate_grams=round(extraction.carbohydrate_grams * scale, 4),
        fat_grams=round(extraction.fat_grams * scale, 4),
        fiber_grams=_scale_optional(extraction.fiber_grams, scale),
        sugar_grams=_scale_optional(extraction.sugar_grams, scale),
        sodium_milligrams=_scale_optional(extraction.sodium_milligrams, scale),
    )


def _has_core_nutrients(extraction: RawNutritionLabelExtraction) -> bool:
    return all(
        value is not None
        for value in (
            extraction.calories_kcal,
            extraction.protein_grams,
            extraction.carbohydrate_grams,
            extraction.fat_grams,
        )
    )


def _scale_optional(value: float | None, scale: float) -> float | None:
    return None if value is None else round(value * scale, 4)


def _clean_optional_text(value: str | None) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _request_payload(image_base64: str) -> dict:
    nullable_number = {"type": ["number", "null"], "minimum": 0}
    nullable_positive_number = {"type": ["number", "null"], "exclusiveMinimum": 0}
    nullable_string = {"type": ["string", "null"]}

    return {
        "model": settings.openai_model,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Read only values visibly printed on this nutrition facts label. "
                            "Do not infer, estimate, or repair unreadable numbers. Use null for "
                            "anything not clearly visible. Energy must be kilocalories, sodium must "
                            "be milligrams, and macronutrients must be grams. Identify whether the "
                            "reported values are per serving or per 100 grams. Never convert values."
                        ),
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Extract the visible product name, brand, serving basis, serving gram "
                            "weight, calories, protein, carbohydrate, fat, fiber, sugar, and sodium."
                        ),
                    },
                    {
                        "type": "input_image",
                        "image_url": f"data:image/jpeg;base64,{image_base64}",
                        "detail": "high",
                    },
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "nutrition_label_extraction",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "display_name",
                        "brand_owner",
                        "serving_size_text",
                        "serving_size_grams",
                        "nutrition_basis",
                        "calories_kcal",
                        "protein_grams",
                        "carbohydrate_grams",
                        "fat_grams",
                        "fiber_grams",
                        "sugar_grams",
                        "sodium_milligrams",
                        "confidence",
                        "warnings",
                    ],
                    "properties": {
                        "display_name": nullable_string,
                        "brand_owner": nullable_string,
                        "serving_size_text": nullable_string,
                        "serving_size_grams": nullable_positive_number,
                        "nutrition_basis": {
                            "type": "string",
                            "enum": ["per_serving", "per_100g", "unknown"],
                        },
                        "calories_kcal": nullable_number,
                        "protein_grams": nullable_number,
                        "carbohydrate_grams": nullable_number,
                        "fat_grams": nullable_number,
                        "fiber_grams": nullable_number,
                        "sugar_grams": nullable_number,
                        "sodium_milligrams": nullable_number,
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                        "warnings": {"type": "array", "items": {"type": "string"}},
                    },
                },
            }
        },
    }
