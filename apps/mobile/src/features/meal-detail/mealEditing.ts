import type {
  FoodSearchResult,
  MealItemCreate,
  MealItemRead,
  NutrientPer100g,
} from "@living-nutrition/shared-types";
import { calculateConsumedNutrients } from "@living-nutrition/validation";

type SnapshotShape = {
  nutrientsPer100g?: Partial<NutrientPer100g>;
  consumedNutrients?: Partial<NutrientPer100g>;
  consumedGrams?: number;
  confirmedGrams?: number;
};

export type PortionNutrientDisplayRow = {
  label: string;
  value: string;
  accessibilityLabel: string;
};

export function buildEditedMealItem(item: MealItemRead, consumedGrams: number): MealItemCreate {
  const nutrientsPer100g = getNutrientsPer100gFromSnapshot(item);
  const nutrients = scaleNutrients(nutrientsPer100g, consumedGrams);

  return {
    foodId: item.foodId,
    displayName: item.displayName,
    consumedGrams,
    servingQuantity: consumedGrams,
    servingUnit: "grams",
    calories: nutrients.caloriesKcal,
    proteinGrams: nutrients.proteinGrams,
    carbohydrateGrams: nutrients.carbohydrateGrams,
    fatGrams: nutrients.fatGrams,
    fiberGrams: nutrients.fiberGrams,
    sugarGrams: nutrients.sugarGrams,
    sodiumMilligrams: nutrients.sodiumMilligrams,
    sourceProvider: item.sourceProvider,
    sourceExternalId: item.sourceExternalId,
    sourceVersion: item.sourceVersion,
    sourceReference: item.sourceReference,
    nutrientSnapshotJson: {
      ...item.nutrientSnapshotJson,
      nutrientsPer100g,
      consumedNutrients: nutrients,
      consumedGrams,
      servingLabel: `${roundNumber(consumedGrams)}g adjusted`,
      adjustedAt: new Date().toISOString(),
    },
    confidence: {
      ...item.confidence,
      portion: "verified",
      explanation: "Nutrition recalculated from the adjusted grams entered by the user.",
    },
    userConfirmed: true,
    preparationMethod: item.preparationMethod,
    addedOilGrams: item.addedOilGrams,
    notes: item.notes,
  };
}

/** Replaces a saved item with a user-selected provider record while retaining the original snapshot for auditability. */
export function buildReplacementMealItem(
  item: MealItemRead,
  replacement: FoodSearchResult,
  consumedGrams: number
): MealItemCreate {
  const nutrients = calculateConsumedNutrients(replacement.nutrientsPer100g, consumedGrams);

  return {
    foodId: replacement.id,
    displayName: replacement.displayName,
    consumedGrams,
    servingQuantity: consumedGrams,
    servingUnit: "grams",
    calories: nutrients.caloriesKcal,
    proteinGrams: nutrients.proteinGrams,
    carbohydrateGrams: nutrients.carbohydrateGrams,
    fatGrams: nutrients.fatGrams,
    fiberGrams: nutrients.fiberGrams,
    sugarGrams: nutrients.sugarGrams,
    sodiumMilligrams: nutrients.sodiumMilligrams,
    sourceProvider: replacement.provider,
    sourceExternalId: replacement.externalId,
    sourceVersion: replacement.dataType,
    sourceReference: replacement.sourceReference,
    nutrientSnapshotJson: {
      nutrientsPer100g: replacement.nutrientsPer100g,
      consumedNutrients: nutrients,
      consumedGrams,
      servingLabel: `${roundNumber(consumedGrams)}g replacement`,
      replacement: {
        previousFoodId: item.foodId,
        previousDisplayName: item.displayName,
        previousSourceProvider: item.sourceProvider,
        previousSourceExternalId: item.sourceExternalId,
        selectedAt: new Date().toISOString(),
      },
    },
    confidence: {
      identity: "high",
      portion: "verified",
      nutritionRecord: replacement.recordConfidence,
      explanation:
        "This provider record was selected to replace the previously logged food. Nutrition was recalculated from the grams entered.",
    },
    userConfirmed: true,
    preparationMethod: item.preparationMethod,
    addedOilGrams: item.addedOilGrams,
    notes: item.notes,
  };
}

/** Creates a confirmed saved-meal item from a provider record selected during meal editing. */
export function buildAddedMealItem(
  food: FoodSearchResult,
  consumedGrams: number
): MealItemCreate {
  const nutrients = calculateConsumedNutrients(food.nutrientsPer100g, consumedGrams);

  return {
    foodId: food.id,
    displayName: food.displayName,
    consumedGrams,
    servingQuantity: consumedGrams,
    servingUnit: "grams",
    calories: nutrients.caloriesKcal,
    proteinGrams: nutrients.proteinGrams,
    carbohydrateGrams: nutrients.carbohydrateGrams,
    fatGrams: nutrients.fatGrams,
    fiberGrams: nutrients.fiberGrams,
    sugarGrams: nutrients.sugarGrams,
    sodiumMilligrams: nutrients.sodiumMilligrams,
    sourceProvider: food.provider,
    sourceExternalId: food.externalId,
    sourceVersion: food.dataType,
    sourceReference: food.sourceReference,
    nutrientSnapshotJson: {
      nutrientsPer100g: food.nutrientsPer100g,
      consumedNutrients: nutrients,
      consumedGrams,
      servingLabel: `${roundNumber(consumedGrams)}g added during meal edit`,
      originalNutrientIds: food.originalNutrientIds,
      qualityFlags: food.qualityFlags,
      addedDuringMealEditAt: new Date().toISOString(),
    },
    confidence: {
      identity: "high",
      portion: "verified",
      nutritionRecord: food.recordConfidence,
      explanation:
        "This provider record was added to the saved meal and recalculated from the grams entered.",
    },
    userConfirmed: true,
    preparationMethod: null,
    addedOilGrams: 0,
    notes: null,
  };
}

/** Supplies a local editor row before a newly selected provider record is persisted. */
export function buildAddedMealDraft(
  food: FoodSearchResult,
  id: string,
  consumedGrams = 100
): MealItemRead {
  const item = buildAddedMealItem(food, consumedGrams);
  const now = new Date().toISOString();

  return {
    ...item,
    id,
    createdAt: now,
    updatedAt: now,
  };
}

export function getNutrientsPer100gFromSnapshot(item: MealItemRead): NutrientPer100g {
  const snapshot = item.nutrientSnapshotJson as SnapshotShape;
  const direct = snapshot.nutrientsPer100g;

  if (direct?.caloriesKcal !== undefined) {
    return normalizeNutrients(direct);
  }

  const grams = snapshot.confirmedGrams || snapshot.consumedGrams || item.consumedGrams;
  const consumed = snapshot.consumedNutrients;

  if (consumed && grams > 0) {
    const scale = 100 / grams;
    return {
      caloriesKcal: Number(consumed.caloriesKcal || item.calories) * scale,
      proteinGrams: Number(consumed.proteinGrams || item.proteinGrams) * scale,
      carbohydrateGrams: Number(consumed.carbohydrateGrams || item.carbohydrateGrams) * scale,
      fatGrams: Number(consumed.fatGrams || item.fatGrams) * scale,
      fiberGrams: scaleOptional(consumed.fiberGrams ?? item.fiberGrams ?? undefined, scale),
      sugarGrams: scaleOptional(consumed.sugarGrams ?? item.sugarGrams ?? undefined, scale),
      sodiumMilligrams: scaleOptional(consumed.sodiumMilligrams ?? item.sodiumMilligrams ?? undefined, scale),
    };
  }

  const scale = item.consumedGrams > 0 ? 100 / item.consumedGrams : 1;
  return {
    caloriesKcal: item.calories * scale,
    proteinGrams: item.proteinGrams * scale,
    carbohydrateGrams: item.carbohydrateGrams * scale,
    fatGrams: item.fatGrams * scale,
    fiberGrams: scaleOptional(item.fiberGrams ?? undefined, scale),
    sugarGrams: scaleOptional(item.sugarGrams ?? undefined, scale),
    sodiumMilligrams: scaleOptional(item.sodiumMilligrams ?? undefined, scale),
  };
}

export function scaleNutrients(nutrientsPer100g: NutrientPer100g, consumedGrams: number): NutrientPer100g {
  const scale = Math.max(consumedGrams, 0) / 100;
  return {
    caloriesKcal: nutrientsPer100g.caloriesKcal * scale,
    proteinGrams: nutrientsPer100g.proteinGrams * scale,
    carbohydrateGrams: nutrientsPer100g.carbohydrateGrams * scale,
    fatGrams: nutrientsPer100g.fatGrams * scale,
    fiberGrams: scaleOptional(nutrientsPer100g.fiberGrams, scale),
    sugarGrams: scaleOptional(nutrientsPer100g.sugarGrams, scale),
    sodiumMilligrams: scaleOptional(nutrientsPer100g.sodiumMilligrams, scale),
  };
}

export function parsePositiveNumber(value: string | null | undefined) {
  const parsed = Number(value?.replace(",", ".") ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}

/** Formats saved snapshot nutrients for the grams currently shown in the meal editor. */
export function formatPortionNutrientRows(
  nutrients: NutrientPer100g
): PortionNutrientDisplayRow[] {
  return [
    portionNutrientRow("Calories", nutrients.caloriesKcal, "kcal"),
    portionNutrientRow("Protein", nutrients.proteinGrams, "g"),
    portionNutrientRow("Carbohydrates", nutrients.carbohydrateGrams, "g"),
    portionNutrientRow("Fat", nutrients.fatGrams, "g"),
    optionalPortionNutrientRow("Fiber", nutrients.fiberGrams, "g"),
    optionalPortionNutrientRow("Sugar", nutrients.sugarGrams, "g"),
    optionalPortionNutrientRow("Sodium", nutrients.sodiumMilligrams, "mg"),
  ].filter((row): row is PortionNutrientDisplayRow => Boolean(row));
}

function normalizeNutrients(value: Partial<NutrientPer100g>): NutrientPer100g {
  return {
    caloriesKcal: Number(value.caloriesKcal || 0),
    proteinGrams: Number(value.proteinGrams || 0),
    carbohydrateGrams: Number(value.carbohydrateGrams || 0),
    fatGrams: Number(value.fatGrams || 0),
    fiberGrams: value.fiberGrams,
    sugarGrams: value.sugarGrams,
    sodiumMilligrams: value.sodiumMilligrams,
  };
}

function scaleOptional(value: number | undefined, scale: number) {
  return value === undefined ? undefined : value * scale;
}

function portionNutrientRow(
  label: string,
  value: number,
  unit: "g" | "mg" | "kcal"
): PortionNutrientDisplayRow {
  const roundedValue = unit === "kcal" || unit === "mg" ? Math.round(value) : roundNumber(value);
  const display = `${roundedValue} ${unit}`;

  return {
    label,
    value: display,
    accessibilityLabel: `${label}: ${display}, based on the portion entered`,
  };
}

function optionalPortionNutrientRow(
  label: string,
  value: number | undefined,
  unit: "g" | "mg"
) {
  return value === undefined ? undefined : portionNutrientRow(label, value, unit);
}
