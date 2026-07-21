import type { DiaryDay, DiaryTotals, MealRead, NutritionGoal } from "@living-nutrition/shared-types";

export type NutrientKey =
  | "calories"
  | "proteinGrams"
  | "carbohydrateGrams"
  | "fatGrams"
  | "fiberGrams"
  | "sugarGrams"
  | "sodiumMilligrams";

export type NutrientDetailRow = {
  key: NutrientKey;
  label: string;
  value: number;
  target?: number;
  unit: "kcal" | "g" | "mg";
  tone: "neutral" | "protein" | "carbs" | "fat" | "fiber" | "insight";
  targetLabel: string;
};

export type MealNutrientContribution = {
  id: string;
  name: string;
  itemCount: number;
  calories: number;
  proteinGrams: number;
  carbohydrateGrams: number;
  fatGrams: number;
  sourceProviders: string[];
};

export function buildNutrientDetailRows(
  totals: DiaryTotals,
  goal: NutritionGoal | null | undefined
): NutrientDetailRow[] {
  return [
    row("calories", "Calories", totals.calories, goal?.caloriesKcal, "kcal", "neutral"),
    row("proteinGrams", "Protein", totals.proteinGrams, goal?.proteinGrams, "g", "protein"),
    row("carbohydrateGrams", "Carbohydrates", totals.carbohydrateGrams, goal?.carbohydrateGrams, "g", "carbs"),
    row("fatGrams", "Fat", totals.fatGrams, goal?.fatGrams, "g", "fat"),
    row("fiberGrams", "Fiber", totals.fiberGrams, goal?.fiberGrams ?? undefined, "g", "fiber"),
    row("sugarGrams", "Sugar", totals.sugarGrams, undefined, "g", "insight"),
    row("sodiumMilligrams", "Sodium", totals.sodiumMilligrams, goal?.sodiumMilligrams ?? undefined, "mg", "insight"),
  ];
}

export function buildMealContributions(meals: MealRead[]): MealNutrientContribution[] {
  return meals.map((meal) => ({
    id: meal.id,
    name: meal.name,
    itemCount: meal.items.length,
    calories: sumMealNutrient(meal, "calories"),
    proteinGrams: sumMealNutrient(meal, "proteinGrams"),
    carbohydrateGrams: sumMealNutrient(meal, "carbohydrateGrams"),
    fatGrams: sumMealNutrient(meal, "fatGrams"),
    sourceProviders: Array.from(new Set(meal.items.map((item) => item.sourceProvider).filter(Boolean))),
  }));
}

export function nutrientProgress(value: number, target?: number) {
  if (!target || target <= 0) {
    return undefined;
  }

  return Math.min(Math.max(value / target, 0), 1);
}

export function formatNutrientAmount(value: number, unit: NutrientDetailRow["unit"]) {
  const rounded = Math.round(value);
  return `${rounded}${unit === "kcal" ? " kcal" : unit}`;
}

export function formatNutrientTarget(row: NutrientDetailRow) {
  if (row.target === undefined) {
    return row.targetLabel;
  }

  return `${formatNutrientAmount(row.target, row.unit)} daily target`;
}

function row(
  key: NutrientKey,
  label: string,
  value: number,
  target: number | undefined,
  unit: NutrientDetailRow["unit"],
  tone: NutrientDetailRow["tone"]
): NutrientDetailRow {
  return {
    key,
    label,
    value,
    target,
    unit,
    tone,
    targetLabel: key === "sugarGrams" ? "No daily target set" : "No daily target set by you",
  };
}

function sumMealNutrient(meal: MealRead, nutrient: keyof Pick<DiaryTotals, "calories" | "proteinGrams" | "carbohydrateGrams" | "fatGrams">) {
  return meal.items.reduce((total, item) => total + item[nutrient], 0);
}

export function getNutrientDetailDate(value?: string | string[]) {
  const date = Array.isArray(value) ? value[0] : value;
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayKey();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
