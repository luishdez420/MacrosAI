import base64
import json
import re
import warnings
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import httpx
from fastapi import HTTPException, status
from PIL import Image, ImageOps
from pydantic import BaseModel, Field, ValidationError

from app.core.config import settings
from app.nutrition.calculations import calculate_consumed_nutrients
from app.nutrition.provider_registry import (
    NutritionProviderRegistry,
    NutritionProviderUnavailableError,
)
from app.schemas.analysis import (
    CandidateViewEvidence,
    MealAnalysisItem,
    MealAnalysisResult,
    MealAnalysisStatus,
    PortionRangeGrams,
    ViewEvidence,
    ViewEvidenceStatus,
)
from app.schemas.common import ConfidenceBreakdown, ConfidenceTier, NutrientsPer100g
from app.schemas.food import FoodSearchResult


OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MAX_ANALYSIS_IMAGE_BYTES = 12 * 1024 * 1024
MAX_ANALYSIS_IMAGE_COUNT = 3
MAX_ANALYSIS_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024
MAX_ANALYSIS_IMAGE_PIXELS = 36_000_000
# A 12 MiB decoded image expands to at most 16 MiB in base64. The small
# allowance covers a data URL prefix while rejecting whitespace/padding abuse
# before decoding allocates another large byte buffer.
MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS = (MAX_ANALYSIS_IMAGE_BYTES * 4) // 3 + 1024
# Keep the combined request below the decoded 18 MiB budget before Pillow
# decodes any image. The allowance covers up to three data-URL prefixes.
MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS = (
    (MAX_ANALYSIS_TOTAL_IMAGE_BYTES * 4) // 3 + (3 * 1024)
)


class DetectedFoodItem(BaseModel):
    name: str = Field(min_length=1)
    candidate_labels: list[str] = Field(default_factory=list)
    serving_label: str = Field(min_length=1)
    estimated_grams: float = Field(ge=0)
    portion_range_grams: PortionRangeGrams | None = None
    visible_preparation: str = "not_sure"
    possible_hidden_ingredients: list[str] = Field(default_factory=list)
    # Model-reported review cues for the submitted image sequence. They never
    # establish verified identity or a precise portion.
    visible_view_indexes: list[int] = Field(default_factory=list)
    candidate_view_evidence: list[CandidateViewEvidence] = Field(default_factory=list)
    view_disagreement: bool = False
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

VISIBLE_PREPARATIONS = {
    "raw",
    "grilled",
    "baked",
    "fried",
    "boiled",
    "steamed",
    "not_sure",
}


async def analyze_meal_photo(
    image_base64s: list[str],
    registry: NutritionProviderRegistry,
    *,
    reference_plate_diameter_mm: float | None = None,
) -> MealAnalysisResult:
    detected_meal = await identify_foods_with_openai(
        image_base64s,
        reference_plate_diameter_mm=reference_plate_diameter_mm,
    )

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
            image_count=len(image_base64s),
            reference_plate_diameter_mm=reference_plate_diameter_mm,
        )

    analyzed_items = [
        await analyze_detected_item(item, registry, image_count=len(image_base64s))
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
        image_count=len(image_base64s),
        reference_plate_diameter_mm=reference_plate_diameter_mm,
    )


async def identify_foods_with_openai(
    image_base64s: list[str],
    *,
    reference_plate_diameter_mm: float | None = None,
) -> DetectedMeal:
    if settings.e2e_fixture_mode:
        # Exercise request validation in E2E while avoiding a paid vision call.
        # The returned item still has to pass provider matching and the normal
        # confirmation workflow before a meal can be logged.
        sanitize_base64_images(image_base64s)
        return DetectedMeal(
            meal_name="Fixture grilled chicken meal",
            summary="A deterministic review-only meal for automated device tests.",
            notes="This is test fixture data, not a nutrition estimate.",
            items=[
                DetectedFoodItem(
                    name="chicken breast grilled",
                    candidate_labels=["chicken breast grilled", "chicken breast cooked"],
                    serving_label="1 grilled breast portion",
                    estimated_grams=140,
                    portion_range_grams=PortionRangeGrams(minimum=110, maximum=180),
                    visible_preparation="grilled",
                    possible_hidden_ingredients=["cooking oil"],
                    visible_view_indexes=list(range(1, len(image_base64s) + 1)),
                    candidate_view_evidence=[
                        CandidateViewEvidence(
                            label="chicken breast grilled",
                            observed_in_view_indexes=list(range(1, len(image_base64s) + 1)),
                        )
                    ],
                    view_disagreement=False,
                    identity_confidence=ConfidenceTier.medium,
                    portion_confidence=ConfidenceTier.low,
                    notes="Confirm the food and weight before logging.",
                )
            ],
        )

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is missing, so the meal photo cannot be analyzed.",
        )

    sanitized_images = sanitize_base64_images(image_base64s)
    image_content = [
        {
            "type": "input_image",
            "image_url": f"data:image/jpeg;base64,{sanitized_image}",
            "detail": "high",
        }
        for sanitized_image in sanitized_images
    ]

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
                                    "Estimate grams only from visible portion cues. Also return a "
                                    "conservative portion_range_grams with minimum and maximum values. "
                                    "For common whole "
                                    "foods, use normal serving conventions, for example one medium "
                                    "banana is about 118 grams. If portion is uncertain, use the most "
                                    "reasonable single-serving estimate and mark portion confidence low. "
                                    "Return visible_preparation only when it is visible (otherwise use "
                                    "not_sure), and possible_hidden_ingredients only as prompts for "
                                    "user review, never as facts. "
                                    "When multiple images are supplied, they are different views of the "
                                    "same meal. Use them only to corroborate what is visibly present; do "
                                    "not count the same food more than once or treat additional views as "
                                    "proof of hidden ingredients, exact weight, or preparation details. "
                                    "Number submitted views starting at 1. For each food, report only the "
                                    "visible_view_indexes where that food has a visible cue, include "
                                    "candidate_view_evidence for alternates when a view supports them, and set "
                                    "view_disagreement true when views give competing identity cues. Seeing a "
                                    "food in more than one view is a review aid, never a verified identity. "
                                    f"{plate_reference_instruction(reference_plate_diameter_mm)}"
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
                                    "Identify the visible food items across these meal photo views and "
                                    "estimate the visible serving size. Return no nutrition numbers. "
                                    "Extra views can reduce ambiguity but the user still confirms every "
                                    "food, preparation detail, and portion. "
                                    f"There are {len(sanitized_images)} submitted views, numbered in the "
                                    "same order as the images below starting at 1. "
                                    f"{plate_reference_instruction(reference_plate_diameter_mm)}"
                                ),
                            },
                            *image_content,
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
                                                "portion_range_grams",
                                                "visible_preparation",
                                                "possible_hidden_ingredients",
                                                "visible_view_indexes",
                                                "candidate_view_evidence",
                                                "view_disagreement",
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
                                            "portion_range_grams": {
                                                "type": "object",
                                                "additionalProperties": False,
                                                "required": ["minimum", "maximum"],
                                                "properties": {
                                                    "minimum": {"type": "number"},
                                                    "maximum": {"type": "number"},
                                                },
                                            },
                                            "visible_preparation": {
                                                "type": "string",
                                                "enum": ["raw", "grilled", "baked", "fried", "boiled", "steamed", "not_sure"],
                                            },
                                            "possible_hidden_ingredients": {
                                                "type": "array",
                                                "items": {"type": "string"},
                                            },
                                            "visible_view_indexes": {
                                                "type": "array",
                                                "items": {"type": "integer"},
                                            },
                                            "candidate_view_evidence": {
                                                "type": "array",
                                                "items": {
                                                    "type": "object",
                                                    "additionalProperties": False,
                                                    "required": ["label", "observed_in_view_indexes"],
                                                    "properties": {
                                                        "label": {"type": "string"},
                                                        "observed_in_view_indexes": {
                                                            "type": "array",
                                                            "items": {"type": "integer"},
                                                        },
                                                    },
                                                },
                                            },
                                            "view_disagreement": {"type": "boolean"},
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
            detail=(
                "Meal analysis failed at the vision service "
                f"(HTTP {response.status_code}). Try again or log the food manually."
            ),
        )

    try:
        return DetectedMeal.model_validate_json(extract_response_text(response.json()))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Meal analysis returned an unreadable result. "
                "Try again or log the food manually."
            ),
        ) from exc


def plate_reference_instruction(reference_plate_diameter_mm: float | None) -> str:
    if reference_plate_diameter_mm is None:
        return "No known-size plate reference was provided."

    return (
        f"The user reports that the visible plate is about {round(reference_plate_diameter_mm)} mm across. "
        "Use this only as an optional visual scale cue when the plate edge is clearly visible; "
        "it cannot establish exact grams and must not increase portion confidence by itself."
    )


async def analyze_detected_item(
    detected_item: DetectedFoodItem,
    registry: NutritionProviderRegistry,
    *,
    image_count: int = 1,
) -> MealAnalysisItem:
    search_response = await registry.search_foods(query=detected_item.name, locale="en-US")
    food_record = pick_best_food_record(search_response.items, detected_item.name)
    serving_grams, serving_label, serving_note, portion_confidence = resolve_serving(
        detected_item
    )
    portion_range_grams = resolve_portion_range(detected_item, serving_grams)
    visible_preparation = normalize_visible_preparation(detected_item.visible_preparation)
    possible_hidden_ingredients = normalize_hidden_ingredient_hints(
        detected_item.possible_hidden_ingredients
    )
    view_evidence = resolve_view_evidence(detected_item, image_count=image_count)
    identity_confidence = apply_view_evidence_to_identity_confidence(
        detected_item.identity_confidence,
        view_evidence,
    )

    if not food_record:
        candidate_labels = normalize_candidate_labels(detected_item, image_count=image_count)
        confidence = ConfidenceBreakdown(
            identity=identity_confidence,
            portion=portion_confidence,
            nutrition_record=ConfidenceTier.low,
            explanation="No USDA nutrition record matched this detected food.",
        )
        return MealAnalysisItem(
            detected_name=detected_item.name,
            candidate_labels=candidate_labels,
            candidate_foods=await resolve_candidate_foods(
                candidate_labels,
                registry,
            ),
            display_name=detected_item.name,
            provider="usda",
            external_id="unmatched",
            data_type="unmatched",
            source_reference="https://fdc.nal.usda.gov/",
            quality_assessment=None,
            serving_grams=serving_grams,
            serving_label=serving_label,
            portion_range_grams=portion_range_grams,
            visible_preparation=visible_preparation,
            possible_hidden_ingredients=possible_hidden_ingredients,
            view_evidence=view_evidence,
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
        identity=identity_confidence,
        portion=portion_confidence,
        nutrition_record=nutrition_confidence,
        explanation=confidence_explanation(
            identity_confidence,
            portion_confidence,
            nutrition_confidence,
        ),
    )
    needs_review = any(
        value == ConfidenceTier.low
        for value in (
            identity_confidence,
            portion_confidence,
            nutrition_confidence,
        )
    ) or view_evidence.status == ViewEvidenceStatus.conflicting

    candidate_labels = normalize_candidate_labels(
        detected_item,
        food_record.display_name,
        image_count=image_count,
    )
    candidate_foods = (
        await resolve_candidate_foods(
            candidate_labels,
            registry,
            selected_food_id=food_record.id,
        )
        if identity_confidence in {ConfidenceTier.low, ConfidenceTier.medium}
        else []
    )

    return MealAnalysisItem(
        detected_name=detected_item.name,
        candidate_labels=candidate_labels,
        candidate_foods=candidate_foods,
        display_name=food_record.display_name,
        provider=food_record.provider,
        external_id=food_record.external_id,
        data_type=food_record.data_type,
        source_reference=food_record.source_reference,
        quality_assessment=food_record.quality_assessment,
        serving_grams=round_number(serving_grams),
        serving_label=serving_label,
        portion_range_grams=portion_range_grams,
        visible_preparation=visible_preparation,
        possible_hidden_ingredients=possible_hidden_ingredients,
        view_evidence=view_evidence,
        nutrients=nutrients,
        confidence=confidence,
        needs_review=needs_review,
        notes=join_notes(detected_item.notes, serving_note),
    )


async def resolve_candidate_foods(
    candidate_labels: list[str],
    registry: NutritionProviderRegistry,
    *,
    selected_food_id: str | None = None,
) -> list[FoodSearchResult]:
    """Resolve a small ordered set of scan alternatives without elevating them to confirmed choices."""

    candidates: list[FoodSearchResult] = []
    seen_ids = {selected_food_id} if selected_food_id else set()

    # The first label is the model's primary label. Its selected provider match is already shown.
    for label in candidate_labels[1:]:
        try:
            response = await registry.search_foods(query=label, locale="en-US")
        except NutritionProviderUnavailableError:
            # A candidate lookup must never discard an otherwise usable camera result.
            continue

        record = pick_best_food_record(response.items, label)
        if not record or record.id in seen_ids:
            continue

        candidates.append(record)
        seen_ids.add(record.id)
        if len(candidates) == 3:
            break

    return candidates


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

    if len(value) > MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Image is too large. Use a photo smaller than 12 MB.",
        )

    compact = re.sub(r"\s+", "", value)
    if len(compact) > MAX_ANALYSIS_IMAGE_BASE64_CHARACTERS:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Image is too large. Use a photo smaller than 12 MB.",
        )

    try:
        decoded = base64.b64decode(compact, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="imageBase64 must be valid base64 image data.",
        ) from exc

    if len(decoded) > MAX_ANALYSIS_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Image is too large. Use a photo smaller than 12 MB.",
        )

    if not _has_supported_image_signature(decoded):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="imageBase64 must contain a JPEG, PNG, WebP, or GIF image.",
        )

    normalized = _strip_image_metadata(decoded)
    if len(normalized) > MAX_ANALYSIS_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Image is too large after privacy-safe normalization. Use a smaller photo.",
        )

    return base64.b64encode(normalized).decode("ascii")


def sanitize_base64_images(values: list[str]) -> list[str]:
    """Validate a bounded set of complementary meal images before provider use."""

    if not values:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one meal image is required.",
        )

    if len(values) > MAX_ANALYSIS_IMAGE_COUNT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use no more than three meal photos per analysis.",
        )

    # Request schemas enforce this for HTTP callers, but this helper is also
    # used by worker/test paths. Check the aggregate before allocating decoded
    # image buffers or invoking Pillow so those callers receive the same limit.
    combined_encoded_characters = sum(_base64_payload_character_count(value) for value in values)
    if combined_encoded_characters > MAX_ANALYSIS_TOTAL_IMAGE_BASE64_CHARACTERS:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="The combined meal photos are too large. Use up to three photos totaling 18 MB or less.",
        )

    sanitized_images = [sanitize_base64_image(value) for value in values]
    total_bytes = sum(
        len(base64.b64decode(value, validate=True))
        for value in sanitized_images
    )
    if total_bytes > MAX_ANALYSIS_TOTAL_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="The combined meal photos are too large. Use up to three photos totaling 18 MB or less.",
        )

    return sanitized_images


def _base64_payload_character_count(value: str) -> int:
    """Count encoded payload bytes without allocating a second compact copy."""

    if "," in value and value.strip().startswith("data:"):
        value = value.split(",", 1)[1]
    return sum(1 for character in value if not character.isspace())


def _has_supported_image_signature(value: bytes) -> bool:
    return (
        value.startswith(b"\xff\xd8\xff")
        or value.startswith(b"\x89PNG\r\n\x1a\n")
        or value.startswith((b"GIF87a", b"GIF89a"))
        or (value.startswith(b"RIFF") and len(value) >= 12 and value[8:12] == b"WEBP")
    )


def _strip_image_metadata(value: bytes) -> bytes:
    """Normalize orientation and remove EXIF/container metadata before provider upload."""

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(value)) as source:
                if source.width * source.height > MAX_ANALYSIS_IMAGE_PIXELS:
                    raise ValueError("image exceeds the maximum pixel count")
                # Animated image formats have ambiguous frames and can consume
                # unbounded work. The product accepts a single still photo only.
                if getattr(source, "is_animated", False) or getattr(source, "n_frames", 1) > 1:
                    raise ValueError("animated images are not supported")

                source.load()

                normalized = ImageOps.exif_transpose(source)
                try:
                    output = BytesIO()
                    rgb_image = normalized.convert("RGB")
                    try:
                        rgb_image.save(
                            output,
                            format="JPEG",
                            quality=90,
                            optimize=True,
                        )
                    finally:
                        rgb_image.close()
                    return output.getvalue()
                finally:
                    normalized.close()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image could not be decoded safely. Choose a valid JPEG, PNG, WebP, or GIF photo.",
        ) from exc


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


def resolve_portion_range(
    item: DetectedFoodItem,
    serving_grams: float,
) -> PortionRangeGrams:
    """Keep scan ranges conservative and bounded by known whole-food portions."""

    name = normalize_text(item.name)
    rule = next((portion_rule for key, portion_rule in PORTION_RULES if key in name), None)
    model_range = item.portion_range_grams

    if model_range and model_range.minimum > 0 and model_range.maximum >= model_range.minimum:
        minimum = model_range.minimum
        maximum = model_range.maximum
    elif rule:
        minimum = rule.minimum_grams
        maximum = rule.maximum_grams
    else:
        minimum = max(1, serving_grams * 0.65)
        maximum = max(minimum, serving_grams * 1.35)

    if rule:
        minimum = max(rule.minimum_grams, minimum)
        maximum = min(rule.maximum_grams, maximum)
        if maximum < minimum:
            minimum = rule.minimum_grams
            maximum = rule.maximum_grams

    return PortionRangeGrams(
        minimum=round_number(minimum),
        maximum=round_number(maximum),
    )


def normalize_visible_preparation(value: str) -> str:
    normalized = normalize_text(value).replace(" ", "_")
    aliases = {"grill": "grilled", "bake": "baked", "boil": "boiled", "steam": "steamed"}
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in VISIBLE_PREPARATIONS else "not_sure"


def normalize_hidden_ingredient_hints(values: list[str]) -> list[str]:
    hints: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = re.sub(r"\s+", " ", value).strip()
        key = normalize_text(cleaned)
        if cleaned and key and key not in seen:
            seen.add(key)
            hints.append(cleaned)
    return hints[:4]


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


def normalize_view_indexes(values: list[int], image_count: int) -> list[int]:
    """Keep model-provided view indexes bounded to the submitted sequence."""

    return sorted({value for value in values if isinstance(value, int) and 1 <= value <= image_count})


def resolve_view_evidence(
    detected_item: DetectedFoodItem,
    *,
    image_count: int,
) -> ViewEvidence:
    """Turn untrusted scan cues into conservative, review-only view evidence."""

    safe_image_count = max(1, min(image_count, MAX_ANALYSIS_IMAGE_COUNT))
    observed_indexes = normalize_view_indexes(
        detected_item.visible_view_indexes,
        safe_image_count,
    )
    candidate_evidence = normalize_candidate_view_evidence(
        detected_item,
        safe_image_count,
    )

    if safe_image_count == 1:
        return ViewEvidence(
            status=ViewEvidenceStatus.single_view,
            observed_in_view_indexes=observed_indexes or [1],
            candidate_evidence=candidate_evidence,
            explanation="One photo supplied this scan cue. Confirm the food before logging.",
        )

    if detected_item.view_disagreement:
        return ViewEvidence(
            status=ViewEvidenceStatus.conflicting,
            observed_in_view_indexes=observed_indexes,
            candidate_evidence=candidate_evidence,
            explanation="Submitted views gave competing identity cues. Choose or search for the food that matches what you ate.",
        )

    if len(observed_indexes) >= 2:
        return ViewEvidence(
            status=ViewEvidenceStatus.corroborated,
            observed_in_view_indexes=observed_indexes,
            candidate_evidence=candidate_evidence,
            explanation=(
                f"The scan marked this visible in {len(observed_indexes)} of {safe_image_count} views. "
                "This is a review aid, not a verified identification."
            ),
        )

    return ViewEvidence(
        status=ViewEvidenceStatus.unavailable,
        observed_in_view_indexes=observed_indexes,
        candidate_evidence=candidate_evidence,
        explanation=(
            "The submitted views did not provide enough shared identity evidence. "
            "Confirm or replace this food before logging."
        ),
    )


def normalize_candidate_view_evidence(
    detected_item: DetectedFoodItem,
    image_count: int,
) -> list[CandidateViewEvidence]:
    """Deduplicate bounded candidate view cues without inventing missing evidence."""

    evidence_by_label: dict[str, tuple[str, list[int]]] = {}
    for evidence in detected_item.candidate_view_evidence:
        label = re.sub(r"\s+", " ", evidence.label).strip()
        key = normalize_text(label)
        indexes = normalize_view_indexes(evidence.observed_in_view_indexes, image_count)
        if not label or not key or not indexes:
            continue
        current = evidence_by_label.get(key)
        if current:
            evidence_by_label[key] = (current[0], sorted(set(current[1]) | set(indexes)))
        else:
            evidence_by_label[key] = (label, indexes)

    # The selected scan label can inherit its own visible-view cue. Alternate
    # labels must supply their own cue; we never copy the primary's evidence.
    primary_key = normalize_text(detected_item.name)
    primary_indexes = normalize_view_indexes(detected_item.visible_view_indexes, image_count)
    if primary_key and primary_indexes and primary_key not in evidence_by_label:
        evidence_by_label[primary_key] = (detected_item.name.strip(), primary_indexes)

    return [
        CandidateViewEvidence(label=label, observed_in_view_indexes=indexes)
        for label, indexes in evidence_by_label.values()
    ]


def apply_view_evidence_to_identity_confidence(
    identity: ConfidenceTier,
    evidence: ViewEvidence,
) -> ConfidenceTier:
    """Only a contradictory view can reduce confidence; corroboration never raises it."""

    if evidence.status != ViewEvidenceStatus.conflicting:
        return identity

    ordered = [
        ConfidenceTier.verified,
        ConfidenceTier.high,
        ConfidenceTier.medium,
        ConfidenceTier.low,
    ]
    return ordered[min(ordered.index(identity) + 1, len(ordered) - 1)]


def normalize_candidate_labels(
    detected_item: DetectedFoodItem,
    matched_display_name: str | None = None,
    *,
    image_count: int = 1,
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

    if len(normalized_labels) < 2:
        return normalized_labels

    evidence_by_label = {
        normalize_text(evidence.label): len(evidence.observed_in_view_indexes)
        for evidence in normalize_candidate_view_evidence(detected_item, max(1, image_count))
    }
    primary_label, *alternate_labels = normalized_labels
    # The detected primary remains first. Only alternate search suggestions are
    # ranked by the number of submitted views that visibly supported the label.
    ranked_alternates = sorted(
        enumerate(alternate_labels),
        key=lambda item: (-evidence_by_label.get(normalize_text(item[1]), 0), item[0]),
    )
    return [primary_label, *(label for _, label in ranked_alternates)][:4]


def summarize_items(items: list[MealAnalysisItem]) -> str:
    names = [item.detected_name for item in items]

    if not names:
        return "No foods were detected."

    if len(names) == 1:
        return f"Detected {names[0]}."

    return f"Detected {', '.join(names[:-1])}, and {names[-1]}."


def join_notes(*notes: str) -> str:
    return " ".join(note.strip() for note in notes if note and note.strip())
