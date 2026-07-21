import type { FoodQualityAssessment, FoodSearchResult } from "@living-nutrition/shared-types";

type QualityDisplay = {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
  description: string;
};

const displays: Record<FoodQualityAssessment["status"], QualityDisplay> = {
  complete: {
    label: "Basic checks passed",
    tone: "success",
    description: "The normalized provider record passed the app's basic completeness checks. Confirm the portion you ate.",
  },
  needs_review: {
    label: "Needs source review",
    tone: "warning",
    description: "The provider record has a serving, freshness, or comparison warning. Review it before logging.",
  },
  insufficient_data: {
    label: "Insufficient data",
    tone: "danger",
    description: "Essential per-100g nutrition is incomplete or invalid. Choose another record or correct it before logging.",
  },
  user_entered: {
    label: "User-entered record",
    tone: "warning",
    description: "This custom record is based on user-entered values. Check it against the package label before relying on it.",
  },
};

export function foodQualityDisplay(assessment?: FoodQualityAssessment): QualityDisplay {
  return assessment ? displays[assessment.status] : {
    label: "Source review recommended",
    tone: "warning",
    description: "This record does not include the current quality assessment. Review the source before logging.",
  };
}

export function blocksFoodLogging(food: Pick<FoodSearchResult, "qualityAssessment">) {
  return food.qualityAssessment?.isBlocking === true;
}

export function foodQualitySignals(assessment?: FoodQualityAssessment) {
  if (!assessment?.signals.length) {
    return "No detailed quality signals were provided.";
  }

  const labels: Record<FoodQualityAssessment["signals"][number], string> = {
    provider_record: "provider record",
    user_entered: "user-entered data",
    stale_source: "stale source",
    conflicting_data: "conflicting provider data",
    incomplete_data: "incomplete per-100g data",
    serving_basis_issue: "serving-basis issue",
    validation_issue: "validation issue",
  };

  return assessment.signals.map((signal) => labels[signal]).join(", ");
}
