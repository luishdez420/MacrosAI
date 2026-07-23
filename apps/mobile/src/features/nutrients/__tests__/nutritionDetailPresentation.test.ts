import type { DiaryTotals, MealRead, NutritionGoal } from "@living-nutrition/shared-types";

import {
  buildMealContributions,
  buildNutrientDetailRows,
  formatNutrientTarget,
  nutrientProgress,
} from "../nutritionDetailPresentation";

describe("nutrition detail presentation", () => {
  it("uses only configured targets and leaves sugar without an inferred target", () => {
    const rows = buildNutrientDetailRows(totals(), goal());

    expect(rows.find((row) => row.key === "proteinGrams")).toMatchObject({ target: 140, unit: "g" });
    expect(rows.find((row) => row.key === "fiberGrams")).toMatchObject({ target: 28, tone: "fiber" });
    expect(rows.find((row) => row.key === "sodiumMilligrams")).toMatchObject({ target: 2300, unit: "mg" });
    const sugar = rows.find((row) => row.key === "sugarGrams");
    expect(sugar?.target).toBeUndefined();
    expect(sugar && formatNutrientTarget(sugar)).toBe("No daily target set");
  });

  it("caps visual target progress without changing the displayed total", () => {
    expect(nutrientProgress(180, 140)).toBe(1);
    expect(nutrientProgress(70, 140)).toBe(0.5);
    expect(nutrientProgress(12, undefined)).toBeUndefined();
  });

  it("derives meal contributions from saved meal-item snapshots", () => {
    const [contribution] = buildMealContributions([meal()]);

    expect(contribution).toMatchObject({
      name: "Chicken bowl",
      itemCount: 2,
      calories: 640,
      proteinGrams: 42,
      carbohydrateGrams: 70,
      fatGrams: 20,
      sourceProviders: ["usda", "open_food_facts"],
    });
  });
});

function totals(): DiaryTotals {
  return {
    calories: 640,
    proteinGrams: 42,
    carbohydrateGrams: 70,
    fatGrams: 20,
    fiberGrams: 8,
    sugarGrams: 6,
    sodiumMilligrams: 520,
  };
}

function goal(): NutritionGoal {
  return {
    id: "goal_1",
    startsOn: "2026-07-13",
    caloriesKcal: 2200,
    proteinGrams: 140,
    carbohydrateGrams: 240,
    fatGrams: 70,
    fiberGrams: 28,
    sodiumMilligrams: 2300,
    createdAt: "2026-07-13T12:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
  };
}

function meal(): MealRead {
  const base = {
    consumedGrams: 100,
    servingQuantity: 100,
    servingUnit: "grams",
    fiberGrams: 4,
    sugarGrams: 3,
    sodiumMilligrams: 200,
    sourceExternalId: "fixture",
    sourceVersion: null,
    sourceReference: "Fixture source",
    nutrientSnapshotJson: {},
    confidence: { identity: "verified", portion: "verified", nutritionRecord: "high", explanation: "Fixture" },
    userConfirmed: true,
    preparationMethod: null,
    addedOilGrams: 0,
    notes: null,
    createdAt: "2026-07-13T12:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
  } as const;

  return {
    id: "meal_1",
    revision: 1,
    name: "Chicken bowl",
    loggedAt: "2026-07-13T12:00:00Z",
    notes: null,
    createdAt: "2026-07-13T12:00:00Z",
    updatedAt: "2026-07-13T12:00:00Z",
    items: [
      {
        ...base,
        id: "item_1",
        foodId: "usda:1",
        displayName: "Chicken",
        calories: 500,
        proteinGrams: 40,
        carbohydrateGrams: 50,
        fatGrams: 15,
        sourceProvider: "usda",
      },
      {
        ...base,
        id: "item_2",
        foodId: "open_food_facts:2",
        displayName: "Sauce",
        calories: 140,
        proteinGrams: 2,
        carbohydrateGrams: 20,
        fatGrams: 5,
        sourceProvider: "open_food_facts",
      },
    ],
  };
}
