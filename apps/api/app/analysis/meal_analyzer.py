import base64
import json
import re
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.nutrition.calculations import calculate_consumed_nutrients
from app.nutrition.provider_registry import NutritionProviderRegistry
from app.schemas.analysis import MealAnalysisItem, MealAnalysisResult, MealAnalysisStatus
from app.schemas.common import ConfidenceBreakdown, ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MAX_ANALYSIS_IMAGE_BYTES = 12 * 1024 * 1024


class DetectedFoodItem(BaseModel):
    name: str = Field(min_length=1)
    candidate_labels: list[str] = Field(default_factory=list)
    serving_label: str = Field(min_length=1)
    estimated_grams: float = Field(ge=0)
    identity_confidence: ConfidenceTier
    portion_confidence: ConfidenceTier
    notes: str = ""


class DetectedMeal(BaseModel):
    meal_name: str = Field(min_length=1)
    items: list[DetectedFoodItem]
    summary: str = ""
    notes: str = ""


@dataclass(frozen=True)
class PortionRule:
    default_grams: float
    minimum_grams: float
    maximum_grams: float
    label: str


PORTION_RULES: tuple[tuple[str, PortionRule], ...] = (
    ("banana", PortionRule(118, 70, 165, "1 medium banana")),
    ("apple", PortionRule(182, 100, 260, "1 medium apple")),
    ("orange", PortionRule(131, 80, 220, "1 medium orange")),
    ("egg", PortionRule(50, 38, 70, "1 large egg")),
    ("slice bread", PortionRule(28, 20, 45, "1 slice")),
    ("bread", PortionRule(56, 25, 110, "2 slices")),
    ("cooked rice", PortionRule(158, 90, 260, "1 cup cooked rice")),
    ("rice", PortionRule(158, 90, 260, "1 cup cooked rice")),
    ("cooked pasta", PortionRule(140, 80, 240, "1 cup cooked pasta")),
    ("pasta", PortionRule(140, 80, 240, "1 cup cooked pasta")),
    ("chicken breast", PortionRule(120, 70, 260, "1 cooked chicken breast portion")),
    ("salmon", PortionRule(113, 70, 240, "1 fillet portion")),
    ("steak", PortionRule(113, 70, 260, "1 steak portion")),
    ("potato", PortionRule(173, 90, 320, "1 medium potato")),
    ("avocado", PortionRule(136, 70, 220, "1 avocado")),
    ("yogurt", PortionRule(170, 100, 245, "1 single-serve cup")),
)

LOW_QUALITY_MATCH_WORDS = {
    "babyfood",
    "beverage",
    "cake",
    "chips",
    "dehydrated",
    "dessert",
    "dried",
    "drink",
    "fried",
    "juice",
    "powder",
    "snack",
    "sweetened",
}

CONFIDENCE_SCORE = {
    ConfidenceTier.verified: 4,
    ConfidenceTier.high: 3,
    ConfidenceTier.medium: 2,
    ConfidenceTier.low: 1,
}


async def analyze_meal_photo(
    image_base64: str,
    registry: NutritionProviderRegistry,
) -> MealAnalysisResult:
    detected_meal = await identify_foods_with_openai(image_base64)

    if not detected_meal.items:
        empty_confidence = ConfidenceBreakdown(
            identity=ConfidenceTier.low,
            portion=ConfidenceTier.low,
            nutrition_record=ConfidenceTier.low,
            explanation="No visible foods were identified.",
        )
        return MealAnalysisResult(
            status=MealAnalysisStatus.needs_review,
            meal_name=detected_meal.meal_name or "Meal scan",
            summary="No foods were detected in the photo.",
            notes=detected_meal.notes,
            total_nutrients=zero_nutrients(),
            items=[],
            confidence=empty_confidence,
        )

    analyzed_items = [
        await analyze_detected_item(item, registry)
        for item in detected_meal.items
        if item.name.strip()
    ]
    total_nutrients = sum_nutrients([item.nutrients for item in analyzed_items])
    confidence = summarize_confidence(analyzed_items)
    status_value = (
        MealAnalysisStatus.needs_review
        if any(item.needs_review for item in analyzed_items)
        else MealAnalysisStatus.ready
    )

    return MealAnalysisResult(
        status=status_value,
        meal_name=detected_meal.meal_name,
        summary=detected_meal.summary or summarize_items(analyzed_items),
        notes=detected_meal.notes,
        total_nutrients=total_nutrients,
        items=analyzed_items,
        confidence=confidence,
    )


async def identify_foods_with_openai(image_base64: str) -> DetectedMeal:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is missing, so the meal photo cannot be analyzed.",
        )

    sanitized_image = sanitize_base64_image(image_base64)

    async with httpx.AsyncClient(timeout=35) as client:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "input": [
                    {
                        "role": "system",
                        "content": [
                            {
                                "type": "input_text",
                                "text": (
                                    "You identify visible food from meal photos for a nutrition app. "
                                    "Do not calculate calories or macros. Return only JSON. "
                                    "Use concise USDA FoodData Central search names such as "
                                    "'banana raw', 'chicken breast cooked', or 'white rice cooked'. "
                                    "When identity is uncertain, provide up to three alternate "
                                    "candidate_labels that a user could search or choose instead. "
                                    "Estimate grams only from visible portion cues. For common whole "
                                    "foods, use normal serving conventions, for example one medium "
                                    "banana is about 118 grams. If portion is uncertain, use the most "
                                    "reasonable single-serving estimate and mark portion confidence low."
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
                                    "Identify the food items in this photo and estimate the visible "
                                    "serving size. Return no nutrition numbers."
                                ),
                            },
                            {
                                "type": "input_image",
                                "image_url": f"data:image/jpeg;base64,{sanitized_image}",
                                "detail": "high",
                            },
                        ],
                    },
                ],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "detected_meal",
                        "schema": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["meal_name", "items", "summary", "notes"],
                            "properties": {
                                "meal_name": {"type": "string"},
                                "summary": {"type": "string"},
                                "notes": {"type": "string"},
                                    "items": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": [
                                                "name",
                                                "candidate_labels",
                                                "serving_label",
                                                "estimated_grams",
                                                "identity_confidence",
                                            "portion_confidence",
                                            "notes",
                                        ],
                                        "properties": {
                                            "name": {"type": "string"},
                                            "candidate_labels": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                            },
                                            "serving_label": {"type": "string"},
                                            "estimated_grams": {"type": "number"},
                                            "identity_confidence": {
                                                "type": "string",
                                                "enum": ["verified", "high", "medium", "low"],
                                            },
                                            "portion_confidence": {
                                                "type": "string",
                                                "enum": ["verified", "high", "medium", "low"],
                                            },
                                            "notes": {"type": "string"},
                                        },
                                    },
                                },
                            },
                        },
                    }
                },
            },
        )

    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI meal identification failed: {response.text}",
        )

    try:
        return DetectedMeal.model_validate_json(extract_response_text(response.json()))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenAI returned an unexpected meal format: {exc}",
        ) from exc


async def analyze_detected_item(
    detected_item: DetectedFoodItem,
    registry: NutritionProviderRegistry,
) -> MealAnalysisItem:
    search_response = await registry.search_foods(query=detected_item.name, locale="en-US")
    food_record = pick_best_food_record(search_response.items, detected_item.name)
    serving_grams, serving_label, serving_note, portion_confidence = resolve_serving(
        detected_item
    )

    if not food_record:
        confidence = ConfidenceBreakdown(
            identity=detected_item.identity_confidence,
            portion=portion_confidence,
            nutrition_record=ConfidenceTier.low,
            explanation="No USDA nutrition record matched this detected food.",
        )
        return MealAnalysisItem(
            detected_name=detected_item.name,
            candidate_labels=normalize_candidate_labels(detected_item),
            display_name=detected_item.name,
            provider="usda",
            external_id="unmatched",
            data_type="unmatched",
            source_reference="https://fdc.nal.usda.gov/",
            serving_grams=serving_grams,
            serving_label=serving_label,
            nutrients=zero_nutrients(),
            confidence=confidence,
            needs_review=True,
            notes=join_notes(detected_item.notes, serving_note, "USDA match not found."),
        )

    nutrients = round_nutrients(
        calculate_consumed_nutrients(food_record.nutrients_per_100g, serving_grams)
    )
    nutrition_confidence = food_record.record_confidence
    confidence = ConfidenceBreakdown(
        identity=detected_item.identity_confidence,
        portion=portion_confidence,
        nutrition_record=nutrition_confidence,
        explanation=confidence_explanation(
            detected_item.identity_confidence,
            portion_confidence,
            nutrition_confidence,
        ),
    )
    needs_review = any(
        value == ConfidenceTier.low
        for value in (
            detected_item.identity_confidence,
            portion_confidence,
            nutrition_confidence,
        )
    )

    return MealAnalysisItem(
        detected_name=detected_item.name,
        candidate_labels=normalize_candidate_labels(detected_item, food_record.display_name),
        display_name=food_record.display_name,
        provider=food_record.provider,
        external_id=food_record.external_id,
        data_type=food_record.data_type,
        source_reference=food_record.source_reference,
        serving_grams=round_number(serving_grams),
        serving_label=serving_label,
        nutrients=nutrients,
        confidence=confidence,
        needs_review=needs_review,
        notes=join_notes(detected_item.notes, serving_note),
    )


def extract_response_text(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return str(payload["output_text"])

    for entry in payload.get("output", []):
        for content in entry.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                return str(content["text"])

    raise ValueError("Response did not include output_text.")


def sanitize_base64_image(value: str) -> str:
    if "," in value and value.strip().startswith("data:"):
        value = value.split(",", 1)[1]

    compact = re.sub(r"\s+", "", value)

    try:
        decoded = base64.b64decode(compact, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="imageBase64 must be valid base64 image data.",
        ) from exc

    if len(decoded) > MAX_ANALYSIS_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image is too large. Use a photo smaller than 12 MB.",
        )

    if not _has_supported_image_signature(decoded):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="imageBase64 must contain a JPEG, PNG, WebP, or GIF image.",
        )

    return compact


def _has_supported_image_signature(value: bytes) -> bool:
    return (
        value.startswith(b"\xff\xd8\xff")
        or value.startswith(b"\x89PNG\r\n\x1a\n")
        or value.startswith((b"GIF87a", b"GIF89a"))
        or (value.startswith(b"RIFF") and len(value) >= 12 and value[8:12] == b"WEBP")
    )


def pick_best_food_record(
    foods: list[FoodSearchResult],
    query: str,
) -> FoodSearchResult | None:
    usable_foods = [
        food
        for food in foods
        if food.provider == "usda"
        and food.external_id != "unmatched"
        and has_meaningful_nutrients(food.nutrients_per_100g)
    ]

    if not usable_foods:
        return None

    normalized_query = normalize_text(query)

    def score(food: FoodSearchResult) -> tuple[int, str]:
        name = normalize_text(food.display_name)
        value = 0

        if food.data_type == "Foundation":
            value += 80
        elif food.data_type == "SR Legacy":
            value += 65
        elif food.data_type == "Survey (FNDDS)":
            value += 55
        elif food.data_type == "Branded":
            value += 5

        if name == normalized_query:
            value += 120
        if name.startswith(normalized_query):
            value += 55
        if all(token in name for token in normalized_query.split()):
            value += 40

        value += CONFIDENCE_SCORE.get(food.record_confidence, 1) * 8

        if food.data_type == "Branded":
            value -= 40
        if any(word in name and word not in normalized_query for word in LOW_QUALITY_MATCH_WORDS):
            value -= 35

        return (-value, food.display_name)

    return sorted(usable_foods, key=score)[0]


def resolve_serving(item: DetectedFoodItem) -> tuple[float, str, str, ConfidenceTier]:
    name = normalize_text(item.name)
    rule = next((portion_rule for key, portion_rule in PORTION_RULES if key in name), None)
    serving_grams = item.estimated_grams
    serving_label = item.serving_label.strip()
    confidence = item.portion_confidence
    note = ""

    if serving_grams <= 0 and rule:
        serving_grams = rule.default_grams
        serving_label = rule.label
        confidence = ConfidenceTier.medium
        note = f"Used a standard USDA-style serving estimate: {rule.label}."
    elif serving_grams <= 0:
        serving_grams = 100
        serving_label = serving_label or "100 g estimate"
        confidence = ConfidenceTier.low
        note = "No visible portion cue was found, so a 100 g estimate was used."

    if rule and not (rule.minimum_grams <= serving_grams <= rule.maximum_grams):
        serving_grams = rule.default_grams
        serving_label = rule.label
        confidence = min_confidence(confidence, ConfidenceTier.medium)
        note = f"Adjusted an unlikely portion to a standard estimate: {rule.label}."

    serving_label = serving_label or f"{round_number(serving_grams)} g"
    return serving_grams, serving_label, note, confidence


def summarize_confidence(items: list[MealAnalysisItem]) -> ConfidenceBreakdown:
    if not items:
        return ConfidenceBreakdown(
            identity=ConfidenceTier.low,
            portion=ConfidenceTier.low,
            nutrition_record=ConfidenceTier.low,
            explanation="No analyzable foods were returned.",
        )

    identity = min_confidence(*(item.confidence.identity for item in items))
    portion = min_confidence(*(item.confidence.portion for item in items))
    nutrition_record = min_confidence(*(item.confidence.nutrition_record for item in items))

    return ConfidenceBreakdown(
        identity=identity,
        portion=portion,
        nutrition_record=nutrition_record,
        explanation=confidence_explanation(identity, portion, nutrition_record),
    )


def confidence_explanation(
    identity: ConfidenceTier,
    portion: ConfidenceTier,
    nutrition_record: ConfidenceTier,
) -> str:
    weak_parts = []

    if identity == ConfidenceTier.low:
        weak_parts.append("food identity")
    if portion == ConfidenceTier.low:
        weak_parts.append("portion size")
    if nutrition_record == ConfidenceTier.low:
        weak_parts.append("USDA match")

    if weak_parts:
        return f"Review suggested for {', '.join(weak_parts)}."

    if portion == ConfidenceTier.medium:
        return "Ready to log, with an editable serving estimate."

    return "Ready to log from USDA-matched nutrition data."


def min_confidence(*values: ConfidenceTier) -> ConfidenceTier:
    return min(values, key=lambda value: CONFIDENCE_SCORE[value])


def has_meaningful_nutrients(nutrients: NutrientsPer100g) -> bool:
    return any(
        value > 0
        for value in (
            nutrients.calories_kcal,
            nutrients.protein_grams,
            nutrients.carbohydrate_grams,
            nutrients.fat_grams,
        )
    )


def sum_nutrients(items: list[NutrientsPer100g]) -> NutrientsPer100g:
    return round_nutrients(
        NutrientsPer100g(
            calories_kcal=sum(item.calories_kcal for item in items),
            protein_grams=sum(item.protein_grams for item in items),
            carbohydrate_grams=sum(item.carbohydrate_grams for item in items),
            fat_grams=sum(item.fat_grams for item in items),
            fiber_grams=sum_optional(item.fiber_grams for item in items),
            sugar_grams=sum_optional(item.sugar_grams for item in items),
            sodium_milligrams=sum_optional(item.sodium_milligrams for item in items),
        )
    )


def sum_optional(values: Any) -> float | None:
    values_list = [value for value in values if value is not None]
    return sum(values_list) if values_list else None


def zero_nutrients() -> NutrientsPer100g:
    return NutrientsPer100g(
        calories_kcal=0,
        protein_grams=0,
        carbohydrate_grams=0,
        fat_grams=0,
    )


def round_nutrients(nutrients: NutrientsPer100g) -> NutrientsPer100g:
    return NutrientsPer100g(
        calories_kcal=round_number(nutrients.calories_kcal),
        protein_grams=round_number(nutrients.protein_grams),
        carbohydrate_grams=round_number(nutrients.carbohydrate_grams),
        fat_grams=round_number(nutrients.fat_grams),
        fiber_grams=round_optional(nutrients.fiber_grams),
        sugar_grams=round_optional(nutrients.sugar_grams),
        sodium_milligrams=round_optional(nutrients.sodium_milligrams),
    )


def round_optional(value: float | None) -> float | None:
    return None if value is None else round_number(value)


def round_number(value: float) -> float:
    return round(float(value), 1)


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def normalize_candidate_labels(
    detected_item: DetectedFoodItem,
    matched_display_name: str | None = None,
) -> list[str]:
    labels = [
        detected_item.name,
        *detected_item.candidate_labels,
        *(matched_display_name and [matched_display_name] or []),
    ]
    normalized_labels: list[str] = []
    seen: set[str] = set()

    for label in labels:
        cleaned = re.sub(r"\s+", " ", label).strip()
        key = normalize_text(cleaned)

        if cleaned and key and key not in seen:
            seen.add(key)
            normalized_labels.append(cleaned)

    return normalized_labels[:4]


def summarize_items(items: list[MealAnalysisItem]) -> str:
    names = [item.detected_name for item in items]

    if not names:
        return "No foods were detected."

    if len(names) == 1:
        return f"Detected {names[0]}."

    return f"Detected {', '.join(names[:-1])}, and {names[-1]}."


def join_notes(*notes: str) -> str:
    return " ".join(note.strip() for note in notes if note and note.strip())
