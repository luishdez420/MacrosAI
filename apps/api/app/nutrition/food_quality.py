"""Deterministic, non-medical quality classification for normalized food records."""

from dataclasses import asdict, dataclass
from enum import StrEnum


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


@dataclass(frozen=True)
class FoodQualityAssessment:
    """Explainable status derived only from normalized provider data and flags."""

    status: FoodQualityStatus
    signals: tuple[FoodQualitySignal, ...]
    summary: str
    is_blocking: bool

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["status"] = self.status.value
        value["signals"] = [signal.value for signal in self.signals]
        return value


BLOCKING_FLAGS = frozenset(
    {
        "missing_name",
        "incomplete_per_100g",
        "invalid_per_100g_value",
        "negative_nutrient",
        "possible_kj_confusion",
    }
)

VALIDATION_FLAGS = frozenset(
    {
        "energy_macro_mismatch",
        "negative_nutrient",
        "invalid_per_100g_value",
        "missing_name",
        "possible_kj_confusion",
    }
)

SERVING_FLAGS = frozenset(
    {
        "zero_serving_size",
        "unverified_serving_basis",
        "serving_per_100g_conflict",
    }
)


def assess_food_quality(provider: str, quality_flags: list[str] | tuple[str, ...]) -> FoodQualityAssessment:
    """Classify source completeness without presenting it as medical accuracy.

    A blocking result is reserved for records whose normalized per-100g basis
    cannot be trusted. Stale, conflicting, and serving-basis issues remain
    loggable after user review because a confirmed gram amount can still use a
    complete source record.
    """

    flags = set(quality_flags)
    signals: list[FoodQualitySignal] = [
        FoodQualitySignal.user_entered if provider == "user" else FoodQualitySignal.provider_record
    ]

    if "stale_source_record" in flags:
        signals.append(FoodQualitySignal.stale_source)
    if "duplicate_nutrition_conflict" in flags:
        signals.append(FoodQualitySignal.conflicting_data)
    if "incomplete_per_100g" in flags:
        signals.append(FoodQualitySignal.incomplete_data)
    if flags.intersection(SERVING_FLAGS):
        signals.append(FoodQualitySignal.serving_basis_issue)
    if flags.intersection(VALIDATION_FLAGS):
        signals.append(FoodQualitySignal.validation_issue)

    if flags.intersection(BLOCKING_FLAGS):
        return FoodQualityAssessment(
            status=FoodQualityStatus.insufficient_data,
            signals=tuple(dict.fromkeys(signals)),
            summary="Essential per-100g nutrition data is incomplete or invalid. Choose another record or correct it before logging.",
            is_blocking=True,
        )

    if provider == "user":
        return FoodQualityAssessment(
            status=FoodQualityStatus.user_entered,
            signals=tuple(dict.fromkeys(signals)),
            summary="This is a user-entered record. Check it against the package label before relying on it.",
            is_blocking=False,
        )

    if flags:
        return FoodQualityAssessment(
            status=FoodQualityStatus.needs_review,
            signals=tuple(dict.fromkeys(signals)),
            summary="The provider record has review notes. Confirm the source and portion before logging.",
            is_blocking=False,
        )

    return FoodQualityAssessment(
        status=FoodQualityStatus.complete,
        signals=tuple(dict.fromkeys(signals)),
        summary="The normalized provider record passed the app's basic completeness checks. Confirm the portion you ate.",
        is_blocking=False,
    )
