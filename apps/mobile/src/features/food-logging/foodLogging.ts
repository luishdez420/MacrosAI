import type { FoodSearchResult, MealCreate, NutrientPer100g } from "@living-nutrition/shared-types";

export type PortionMode = "grams" | "ounces" | "servings";
export type FoodLogSource = "manual" | "barcode" | "custom" | "natural";

export const gramsPerOunce = 28.349523125;

type CreateMealFromFoodInput = {
  food: FoodSearchResult;
  grams: number;
  servingLabel: string;
  nutrients: NutrientPer100g;
  servingQuantity: number;
  portionMode: PortionMode;
  source: FoodLogSource;
};

export function createMealFromFood({
  food,
  grams,
  servingLabel,
  nutrients,
  servingQuantity,
  portionMode,
  source,
}: CreateMealFromFoodInput): MealCreate {
  const needsReview = food.recordConfidence === "low";
  const sourceLabel =
    source === "barcode"
      ? "Barcode scan"
      : source === "custom"
        ? "Custom food"
        : source === "natural"
          ? "Natural-language entry"
          : "Manual entry";
  const confidence = {
    identity: source === "barcode" ? ("high" as const) : ("verified" as const),
    portion: "verified" as const,
    nutritionRecord: food.recordConfidence,
    explanation: needsReview
      ? "Review suggested because the source record has low confidence or incomplete data."
      : `${sourceLabel} from a selected nutrition source record.`,
  };

  return {
    name: food.displayName,
    loggedAt: new Date().toISOString(),
    notes: `${sourceLabel} for ${servingLabel}.`,
    items: [
      {
        foodId: food.id,
        displayName: food.displayName,
        consumedGrams: grams,
        servingQuantity,
        servingUnit:
          portionMode === "grams" ? "grams" : portionMode === "ounces" ? "ounces" : "serving",
        calories: nutrients.caloriesKcal,
        proteinGrams: nutrients.proteinGrams,
        carbohydrateGrams: nutrients.carbohydrateGrams,
        fatGrams: nutrients.fatGrams,
        fiberGrams: nutrients.fiberGrams,
        sugarGrams: nutrients.sugarGrams,
        sodiumMilligrams: nutrients.sodiumMilligrams,
        sourceProvider: food.provider,
        sourceExternalId: food.externalId,
        sourceVersion: food.publicationDate || food.dataType,
        sourceReference: food.sourceReference,
        nutrientSnapshotJson: {
          nutrientsPer100g: food.nutrientsPer100g,
          consumedNutrients: nutrients,
          consumedGrams: grams,
          servingLabel,
          recordConfidence: food.recordConfidence,
          qualityFlags: food.qualityFlags ?? [],
          qualityAssessment: food.qualityAssessment,
          sourceReference: food.sourceReference,
          logSource: source,
        },
        confidence,
        userConfirmed: !needsReview,
        addedOilGrams: 0,
        notes: needsReview
          ? "Review suggested because the source record has low confidence or incomplete data."
          : `${sourceLabel}.`,
      },
    ],
  };
}

export function getServingGramWeight(food: FoodSearchResult): number | undefined {
  if (hasGramServing(food)) {
    return Number(food.servingSize);
  }
}

export function hasGramServing(food: FoodSearchResult) {
  const unit = food.servingSizeUnit?.toLowerCase();
  return Boolean(food.servingSize && unit && ["g", "gram", "grams"].includes(unit));
}

export function servingSummary(food: FoodSearchResult) {
  if (hasGramServing(food)) {
    return `${food.servingSize}${food.servingSizeUnit} serving`;
  }

  return `${food.provider.replaceAll("_", " ")} · ${food.dataType}`;
}

export function portionLabel(
  mode: PortionMode,
  amount: string,
  servingGramWeight: number | undefined
) {
  const numericAmount = parsePositiveNumber(amount);

  if (mode === "grams") {
    return `${Math.round(numericAmount)}g`;
  }

  if (mode === "ounces") {
    return `${roundMacro(numericAmount)} oz (${roundMacro(numericAmount * gramsPerOunce)}g)`;
  }

  const servingText = numericAmount === 1 ? "serving" : "servings";
  if (!servingGramWeight) {
    return `${roundMacro(numericAmount)} ${servingText} (gram weight not verified)`;
  }

  return `${roundMacro(numericAmount)} ${servingText} (${Math.round(numericAmount * servingGramWeight)}g)`;
}

export function gramsForPortion(
  mode: PortionMode,
  amount: string,
  servingGramWeight: number | undefined
) {
  const numericAmount = parsePositiveNumber(amount);

  if (mode === "grams") {
    return numericAmount;
  }

  if (mode === "ounces") {
    return numericAmount * gramsPerOunce;
  }

  return servingGramWeight ? numericAmount * servingGramWeight : 0;
}

export function portionAmountForGrams(
  mode: PortionMode,
  grams: number,
  servingGramWeight: number | undefined
) {
  if (!Number.isFinite(grams) || grams <= 0) {
    return "";
  }

  if (mode === "grams") {
    return String(Math.round(grams * 100) / 100);
  }

  if (mode === "ounces") {
    return String(Math.round((grams / gramsPerOunce) * 1000) / 1000);
  }

  return servingGramWeight ? String(Math.round((grams / servingGramWeight) * 100) / 100) : "";
}

export function portionInputLabel(mode: PortionMode) {
  if (mode === "grams") {
    return "Weight in grams";
  }

  if (mode === "ounces") {
    return "Weight in ounces";
  }

  return "Number of servings";
}

export function parsePositiveNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function roundMacro(value: number) {
  return Math.round(value * 10) / 10;
}
