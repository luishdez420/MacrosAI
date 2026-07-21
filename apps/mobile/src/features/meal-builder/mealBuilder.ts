import type {
  FoodSearchResult,
  MealCreate,
  MealItemRead,
  MealType,
  NutrientPer100g,
  RecipeCreate,
} from "@living-nutrition/shared-types";
import { calculateConsumedNutrients } from "@living-nutrition/validation";

import { createMealFromFood, parsePositiveNumber } from "../food-logging/foodLogging";

export type MealBuilderItem = {
  id: string;
  food: FoodSearchResult;
  grams: string;
};

export function nutrientsForBuilderItem(item: MealBuilderItem): NutrientPer100g {
  return calculateConsumedNutrients(item.food.nutrientsPer100g, parsePositiveNumber(item.grams));
}

export function mealBuilderTotals(items: MealBuilderItem[]): NutrientPer100g {
  return items.reduce<NutrientPer100g>(
    (total, item) => {
      const nutrients = nutrientsForBuilderItem(item);
      return {
        caloriesKcal: total.caloriesKcal + nutrients.caloriesKcal,
        proteinGrams: total.proteinGrams + nutrients.proteinGrams,
        carbohydrateGrams: total.carbohydrateGrams + nutrients.carbohydrateGrams,
        fatGrams: total.fatGrams + nutrients.fatGrams,
        fiberGrams: (total.fiberGrams ?? 0) + (nutrients.fiberGrams ?? 0),
        sugarGrams: (total.sugarGrams ?? 0) + (nutrients.sugarGrams ?? 0),
        sodiumMilligrams: (total.sodiumMilligrams ?? 0) + (nutrients.sodiumMilligrams ?? 0),
      };
    },
    {
      caloriesKcal: 0,
      proteinGrams: 0,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    }
  );
}

export function moveBuilderItem(
  items: MealBuilderItem[],
  id: string,
  direction: "up" | "down"
): MealBuilderItem[] {
  const index = items.findIndex((item) => item.id === id);
  const destination = direction === "up" ? index - 1 : index + 1;

  if (index < 0 || destination < 0 || destination >= items.length) {
    return items;
  }

  const reordered = [...items];
  const [moved] = reordered.splice(index, 1);

  if (!moved) {
    return items;
  }

  reordered.splice(destination, 0, moved);
  return reordered;
}

/** Moves an item by a drag-derived offset while keeping the order within bounds. */
export function moveBuilderItemByOffset(
  items: MealBuilderItem[],
  id: string,
  offset: number
): MealBuilderItem[] {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0 || !Number.isFinite(offset) || offset === 0) {
    return items;
  }

  const destination = Math.min(
    Math.max(index + Math.trunc(offset), 0),
    items.length - 1
  );

  if (destination === index) {
    return items;
  }

  const reordered = [...items];
  const [moved] = reordered.splice(index, 1);

  if (!moved) {
    return items;
  }

  reordered.splice(destination, 0, moved);
  return reordered;
}

export function duplicateBuilderItem(
  items: MealBuilderItem[],
  id: string,
  duplicateId: string
): MealBuilderItem[] {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) {
    return items;
  }

  const item = items[index];

  if (!item) {
    return items;
  }

  const duplicated = { ...item, id: duplicateId };
  return [...items.slice(0, index + 1), duplicated, ...items.slice(index + 1)];
}

export function createMealFromBuilder({
  name,
  mealType,
  loggedAt,
  notes,
  items,
}: {
  name: string;
  mealType: MealType;
  loggedAt?: string;
  notes: string;
  items: MealBuilderItem[];
}): MealCreate {
  return {
    name: name.trim() || "Custom meal",
    mealType,
    loggedAt: loggedAt ?? new Date().toISOString(),
    notes: notes.trim() || "Built from confirmed nutrition records.",
    items: items.flatMap((item) => {
      const grams = parsePositiveNumber(item.grams);
      if (!grams) return [];
      const nutrients = nutrientsForBuilderItem(item);
      return createMealFromFood({
        food: item.food,
        grams,
        servingLabel: `${Math.round(grams)}g`,
        nutrients,
        servingQuantity: grams,
        portionMode: "grams",
        source: "manual",
      }).items;
    }),
  };
}

export function createRecipeFromBuilder({
  name,
  mealType,
  notes,
  items,
}: {
  name: string;
  mealType: MealType;
  notes: string;
  items: MealBuilderItem[];
}): RecipeCreate {
  const meal = createMealFromBuilder({ name, mealType, notes, items });
  return {
    name: meal.name,
    mealType: meal.mealType,
    notes: meal.notes,
    items: meal.items,
  };
}

/** Rebuild editable per-100g values from a saved recipe snapshot. */
export function builderItemFromRecipeItem(item: MealItemRead): MealBuilderItem {
  const grams = item.consumedGrams;
  const per100gScale = grams > 0 ? 100 / grams : 0;

  return {
    id: `recipe-${item.id}`,
    grams: String(grams),
    food: {
      id: item.foodId,
      displayName: item.displayName,
      provider: normalizeRecipeProvider(item.sourceProvider),
      externalId: item.sourceExternalId,
      dataType: item.sourceVersion ?? "Saved recipe snapshot",
      brandOwner: null,
      servingSize: null,
      servingSizeUnit: null,
      householdServingText: null,
      nutrientsPer100g: {
        caloriesKcal: item.calories * per100gScale,
        proteinGrams: item.proteinGrams * per100gScale,
        carbohydrateGrams: item.carbohydrateGrams * per100gScale,
        fatGrams: item.fatGrams * per100gScale,
        fiberGrams: (item.fiberGrams ?? 0) * per100gScale,
        sugarGrams: (item.sugarGrams ?? 0) * per100gScale,
        sodiumMilligrams: (item.sodiumMilligrams ?? 0) * per100gScale,
      },
      recordConfidence: item.confidence.nutritionRecord,
      sourceReference: item.sourceReference ?? "Saved recipe snapshot",
    },
  };
}

function normalizeRecipeProvider(value: string): FoodSearchResult["provider"] {
  if (value === "usda" || value === "open_food_facts" || value === "commercial" || value === "user") {
    return value;
  }

  return "user";
}
