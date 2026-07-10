import type {
  FoodDetail,
  FoodServingOption,
  MealItemRead,
  NutrientPer100g,
} from "@living-nutrition/shared-types";
import { getNutrientsPer100gFromSnapshot, roundNumber } from "../meal-detail/mealEditing";

type Tone = "neutral" | "success" | "warning" | "danger";

export type LabeledDisplay = {
  label: string;
  tone: Tone;
  description: string;
};

export type NutrientDisplayRow = {
  label: string;
  value: string;
  accessibilityLabel: string;
};

const providerLabels: Record<string, string> = {
  usda: "USDA FoodData Central",
  open_food_facts: "Open Food Facts",
  user: "Custom food",
  commercial: "Commercial provider",
};

const confidenceLabels: Record<string, LabeledDisplay> = {
  verified: {
    label: "Verified",
    tone: "success",
    description: "Exact source record or user-confirmed custom food data is available.",
  },
  high: {
    label: "High confidence",
    tone: "success",
    description: "The food source is complete enough for normal logging, but portions still need user review.",
  },
  medium: {
    label: "Medium confidence",
    tone: "warning",
    description: "The source is usable, but some details may be estimated or less specific.",
  },
  low: {
    label: "Low confidence",
    tone: "warning",
    description: "Review carefully before logging because source data is incomplete or uncertain.",
  },
};

const qualityFlagLabels: Record<string, LabeledDisplay> = {
  energy_macro_mismatch: {
    label: "Calories do not match macros",
    tone: "warning",
    description: "The energy value is outside the expected range from protein, carbs, and fat.",
  },
  incomplete_per_100g: {
    label: "Incomplete per-100g data",
    tone: "warning",
    description: "One or more core nutrients are missing from the normalized source record.",
  },
  missing_name: {
    label: "Missing food name",
    tone: "danger",
    description: "The provider record did not include a usable product or food name.",
  },
  zero_serving_size: {
    label: "Zero serving size",
    tone: "warning",
    description: "The provider serving size is missing or zero, so servings may not convert to grams.",
  },
  serving_per_100g_conflict: {
    label: "Serving does not match per-100g data",
    tone: "warning",
    description:
      "The provider's per-serving values conflict with its per-100g nutrition, so confirm grams before logging.",
  },
  negative_nutrient: {
    label: "Negative nutrient value",
    tone: "danger",
    description: "A nutrient value from the provider was negative and should be reviewed.",
  },
  possible_kj_confusion: {
    label: "Possible kJ/kcal confusion",
    tone: "warning",
    description: "Calories may have been reported using kilojoules or mixed energy units.",
  },
  stale_source_record: {
    label: "Source record may be stale",
    tone: "warning",
    description:
      "This provider record was retrieved more than 180 days ago. Review the source before relying on it.",
  },
  duplicate_nutrition_conflict: {
    label: "Similar records disagree",
    tone: "warning",
    description:
      "Another provider record with the same food name has substantially different nutrition. Review the source before logging.",
  },
};

export function providerDisplayName(provider?: string) {
  if (!provider) {
    return "Unknown source";
  }

  return providerLabels[provider] ?? titleize(provider);
}

export function confidenceDisplay(confidence?: string): LabeledDisplay {
  if (!confidence) {
    return {
      label: "Needs review",
      tone: "warning",
      description: "No confidence tier was provided for this source record.",
    };
  }

  return confidenceLabels[confidence] ?? {
    label: titleize(confidence),
    tone: "neutral",
    description: "Review this source before logging.",
  };
}

export function qualityFlagDisplay(flag: string): LabeledDisplay {
  return qualityFlagLabels[flag] ?? {
    label: titleize(flag),
    tone: "warning",
    description: "This provider quality flag should be reviewed before logging.",
  };
}

export function formatNutrientRows(nutrients: NutrientPer100g): NutrientDisplayRow[] {
  return [
    nutrientRow("Calories", nutrients.caloriesKcal, "kcal"),
    nutrientRow("Protein", nutrients.proteinGrams, "g"),
    nutrientRow("Carbohydrates", nutrients.carbohydrateGrams, "g"),
    nutrientRow("Fat", nutrients.fatGrams, "g"),
    optionalNutrientRow("Fiber", nutrients.fiberGrams, "g"),
    optionalNutrientRow("Sugar", nutrients.sugarGrams, "g"),
    optionalNutrientRow("Sodium", nutrients.sodiumMilligrams, "mg"),
  ].filter((row): row is NutrientDisplayRow => Boolean(row));
}

export function servingOptionDescription(option: FoodServingOption) {
  const amount = `${roundNumber(option.quantity)} ${option.unit}`;
  const gramText =
    option.grams && option.grams > 0
      ? `${roundNumber(option.grams)}g verified gram weight`
      : "No verified gram weight for this serving.";
  const volumeText =
    option.milliliters && option.milliliters > 0
      ? `${roundNumber(option.milliliters)}ml volume basis`
      : undefined;

  return {
    amount,
    detail: [gramText, volumeText].filter(Boolean).join(" - "),
  };
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "Not provided";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function snapshotFoodDetailFromMealItem(item: MealItemRead): FoodDetail {
  const snapshot = item.nutrientSnapshotJson as {
    qualityFlags?: unknown;
    originalNutrientIds?: unknown;
    servingLabel?: unknown;
    sourceReference?: unknown;
  };
  const nutrientsPer100g = getNutrientsPer100gFromSnapshot(item);
  const qualityFlags = Array.isArray(snapshot.qualityFlags)
    ? snapshot.qualityFlags.filter((flag): flag is string => typeof flag === "string")
    : [];
  const originalNutrientIds =
    snapshot.originalNutrientIds && typeof snapshot.originalNutrientIds === "object"
      ? Object.fromEntries(
          Object.entries(snapshot.originalNutrientIds).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string"
          )
        )
      : {};

  return {
    id: item.foodId,
    displayName: item.displayName,
    provider: normalizeProvider(item.sourceProvider),
    externalId: item.sourceExternalId,
    dataType: item.sourceVersion || "saved_snapshot",
    brandOwner: null,
    publicationDate: null,
    servingSize: item.consumedGrams,
    servingSizeUnit: "g",
    householdServingText:
      typeof snapshot.servingLabel === "string" ? snapshot.servingLabel : item.servingUnit,
    nutrientsPer100g,
    originalNutrientIds,
    qualityFlags,
    recordConfidence: item.confidence.nutritionRecord,
    sourceReference:
      item.sourceReference ||
      (typeof snapshot.sourceReference === "string" ? snapshot.sourceReference : "Saved meal snapshot"),
    retrievedAt: item.updatedAt || item.createdAt,
    servingOptions: [
      {
        label: "Logged portion",
        quantity: roundNumber(item.consumedGrams),
        unit: "grams",
        grams: roundNumber(item.consumedGrams),
      },
      {
        label: "100 grams",
        quantity: 100,
        unit: "grams",
        grams: 100,
      },
    ],
    provenanceSummary:
      "Saved meal snapshot. Live source lookup was unavailable, so these values come from the meal record saved at log time.",
  };
}

function nutrientRow(label: string, value: number, unit: string): NutrientDisplayRow {
  const roundedValue = unit === "kcal" || unit === "mg" ? Math.round(value) : roundNumber(value);
  return {
    label,
    value: `${roundedValue} ${unit}`,
    accessibilityLabel: `${label}: ${roundedValue} ${unit} per 100 grams`,
  };
}

function optionalNutrientRow(label: string, value: number | undefined, unit: string) {
  return value === undefined ? undefined : nutrientRow(label, value, unit);
}

function normalizeProvider(provider: string): FoodDetail["provider"] {
  if (
    provider === "usda" ||
    provider === "open_food_facts" ||
    provider === "commercial" ||
    provider === "user"
  ) {
    return provider;
  }

  return "user";
}

function titleize(value: string) {
  return value
    .replaceAll("_", " ")
    .trim()
    .split(/\s+/)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
}
