import type { FoodSearchResult, MealItemRead } from "@living-nutrition/shared-types";

import {
  builderItemFromRecipeItem,
  createMealFromBuilder,
  createRecipeFromBuilder,
  duplicateBuilderItem,
  mealBuilderTotals,
  moveBuilderItem,
  moveBuilderItemByOffset,
} from "../mealBuilder";
import { dragDestinationForOffset } from "../MealBuilderScreen";

const chicken: FoodSearchResult = {
  id: "usda:chicken",
  displayName: "Grilled chicken breast",
  provider: "usda",
  externalId: "chicken",
  dataType: "Foundation",
  brandOwner: null,
  servingSize: 100,
  servingSizeUnit: "g",
  nutrientsPer100g: {
    caloriesKcal: 165,
    proteinGrams: 31,
    carbohydrateGrams: 0,
    fatGrams: 3.6,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMilligrams: 74,
  },
  recordConfidence: "high",
  sourceReference: "USDA fixture",
};

const rice: FoodSearchResult = {
  ...chicken,
  id: "usda:rice",
  displayName: "Cooked white rice",
  externalId: "rice",
  nutrientsPer100g: {
    caloriesKcal: 130,
    proteinGrams: 2.7,
    carbohydrateGrams: 28,
    fatGrams: 0.3,
    fiberGrams: 0.4,
    sugarGrams: 0,
    sodiumMilligrams: 1,
  },
};

describe("meal builder domain helpers", () => {
  const items = [
    { id: "chicken", food: chicken, grams: "150" },
    { id: "rice", food: rice, grams: "200" },
  ];

  it("totals only the entered grams from provider-backed per-100g data", () => {
    const totals = mealBuilderTotals(items);

    expect(totals.caloriesKcal).toBeCloseTo(507.5);
    expect(totals.proteinGrams).toBeCloseTo(51.9);
    expect(totals.carbohydrateGrams).toBeCloseTo(56);
  });

  it("creates an editable multi-food meal snapshot", () => {
    const meal = createMealFromBuilder({
      name: "Chicken rice bowl",
      mealType: "lunch",
      loggedAt: "2026-07-12T12:30:00.000Z",
      notes: "Lunch",
      items,
    });

    expect(meal).toMatchObject({
      name: "Chicken rice bowl",
      mealType: "lunch",
      loggedAt: "2026-07-12T12:30:00.000Z",
      notes: "Lunch",
      items: [
        { foodId: "usda:chicken", consumedGrams: 150, sourceProvider: "usda" },
        { foodId: "usda:rice", consumedGrams: 200, sourceProvider: "usda" },
      ],
    });
  });

  it("uses the same source-backed meal snapshot when saving a recipe", () => {
    const recipe = createRecipeFromBuilder({
      name: "Chicken rice bowl",
      mealType: "lunch",
      notes: "Lunch",
      items,
    });

    expect(recipe).toMatchObject({
      name: "Chicken rice bowl",
      mealType: "lunch",
      notes: "Lunch",
      items: [
        { foodId: "usda:chicken", consumedGrams: 150, sourceProvider: "usda" },
        { foodId: "usda:rice", consumedGrams: 200, sourceProvider: "usda" },
      ],
    });
  });

  it("rebuilds editable per-100g values from a saved recipe snapshot", () => {
    const snapshot: MealItemRead = {
      id: "recipe-item-1",
      foodId: "usda:chicken",
      displayName: "Grilled chicken breast",
      consumedGrams: 150,
      servingQuantity: 150,
      servingUnit: "grams",
      calories: 247.5,
      proteinGrams: 46.5,
      carbohydrateGrams: 0,
      fatGrams: 5.4,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 111,
      sourceProvider: "usda",
      sourceExternalId: "chicken",
      sourceVersion: "Foundation",
      sourceReference: "USDA fixture",
      nutrientSnapshotJson: { source: "fixture" },
      confidence: {
        identity: "verified",
        portion: "verified",
        nutritionRecord: "high",
        explanation: "Confirmed grams.",
      },
      userConfirmed: true,
      preparationMethod: "grilled",
      addedOilGrams: 0,
      notes: null,
      createdAt: "2026-07-12T12:00:00Z",
      updatedAt: "2026-07-12T12:00:00Z",
    };

    const editable = builderItemFromRecipeItem(snapshot);

    expect(editable.grams).toBe("150");
    expect(editable.food.nutrientsPer100g).toMatchObject({
      caloriesKcal: 165,
      proteinGrams: 31,
      fatGrams: 3.6,
    });
    expect(editable.food.provider).toBe("usda");
  });

  it("moves and duplicates builder items without changing their source-backed values", () => {
    const moved = moveBuilderItem(items, "rice", "up");
    const duplicated = duplicateBuilderItem(moved, "rice", "rice-copy");

    expect(moved.map((item) => item.id)).toEqual(["rice", "chicken"]);
    expect(duplicated.map((item) => item.id)).toEqual(["rice", "rice-copy", "chicken"]);
    expect(duplicated[1]).toMatchObject({
      id: "rice-copy",
      grams: "200",
      food: { id: "usda:rice", provider: "usda" },
    });
    expect(moveBuilderItem(items, "chicken", "up")).toBe(items);
  });

  it("reorders an item by a bounded drag offset", () => {
    const source = [
      { id: "first", food: chicken, grams: "100" },
      { id: "second", food: rice, grams: "100" },
      { id: "third", food: chicken, grams: "100" },
    ];

    expect(moveBuilderItemByOffset(source, "first", 2).map((item) => item.id)).toEqual([
      "second",
      "third",
      "first",
    ]);
    expect(moveBuilderItemByOffset(source, "third", -8).map((item) => item.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(moveBuilderItemByOffset(source, "missing", 1)).toBe(source);
  });

  it("maps drag travel to a bounded live item destination", () => {
    expect(dragDestinationForOffset({ originIndex: 1, totalItems: 4, translationY: 0 })).toBe(1);
    expect(dragDestinationForOffset({ originIndex: 1, totalItems: 4, translationY: 102 })).toBe(2);
    expect(dragDestinationForOffset({ originIndex: 1, totalItems: 4, translationY: 230 })).toBe(3);
    expect(dragDestinationForOffset({ originIndex: 1, totalItems: 4, translationY: -360 })).toBe(0);
  });
});
