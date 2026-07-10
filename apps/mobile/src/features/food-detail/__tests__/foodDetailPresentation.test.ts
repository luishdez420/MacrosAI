import type { MealItemRead } from "@living-nutrition/shared-types";

import {
  confidenceDisplay,
  formatNutrientRows,
  providerDisplayName,
  qualityFlagDisplay,
  servingOptionDescription,
  snapshotFoodDetailFromMealItem,
} from "../foodDetailPresentation";

describe("food detail presentation helpers", () => {
  it("maps provider and confidence labels to user-readable copy", () => {
    expect(providerDisplayName("usda")).toBe("USDA FoodData Central");
    expect(providerDisplayName("open_food_facts")).toBe("Open Food Facts");
    expect(providerDisplayName("unknown_provider")).toBe("Unknown Provider");

    expect(confidenceDisplay("verified")).toMatchObject({
      label: "Verified",
      tone: "success",
    });
    expect(confidenceDisplay("low")).toMatchObject({
      label: "Low confidence",
      tone: "warning",
    });
  });

  it("maps quality flags to warning copy", () => {
    expect(qualityFlagDisplay("energy_macro_mismatch")).toMatchObject({
      label: "Calories do not match macros",
      tone: "warning",
    });
    expect(qualityFlagDisplay("serving_per_100g_conflict")).toMatchObject({
      label: "Serving does not match per-100g data",
      tone: "warning",
    });
    expect(qualityFlagDisplay("stale_source_record")).toMatchObject({
      label: "Source record may be stale",
      tone: "warning",
    });
    expect(qualityFlagDisplay("duplicate_nutrition_conflict")).toMatchObject({
      label: "Similar records disagree",
      tone: "warning",
    });
    expect(qualityFlagDisplay("unexpected_flag")).toMatchObject({
      label: "Unexpected Flag",
      tone: "warning",
    });
  });

  it("formats per-100g nutrients and serving basis details", () => {
    const rows = formatNutrientRows({
      caloriesKcal: 88.7,
      proteinGrams: 1.09,
      carbohydrateGrams: 22.84,
      fatGrams: 0.33,
      fiberGrams: 2.6,
      sugarGrams: 12.23,
      sodiumMilligrams: 1,
    });

    expect(rows.map((row) => row.label)).toEqual([
      "Calories",
      "Protein",
      "Carbohydrates",
      "Fat",
      "Fiber",
      "Sugar",
      "Sodium",
    ]);
    expect(rows[0]).toMatchObject({
      value: "89 kcal",
      accessibilityLabel: "Calories: 89 kcal per 100 grams",
    });

    expect(
      servingOptionDescription({
        label: "Medium banana",
        quantity: 1,
        unit: "piece",
        grams: 118,
      })
    ).toEqual({
      amount: "1 piece",
      detail: "118g verified gram weight",
    });

    expect(
      servingOptionDescription({
        label: "Serving",
        quantity: 1,
        unit: "serving",
      }).detail
    ).toBe("No verified gram weight for this serving.");
  });

  it("builds saved-meal snapshot fallback provenance", () => {
    const item: MealItemRead = {
      id: "meal_item_1",
      foodId: "usda:173944",
      displayName: "Bananas, raw",
      consumedGrams: 118,
      servingQuantity: 118,
      servingUnit: "grams",
      calories: 105,
      proteinGrams: 1.3,
      carbohydrateGrams: 27,
      fatGrams: 0.4,
      fiberGrams: 3.1,
      sugarGrams: 14.4,
      sodiumMilligrams: 1.2,
      sourceProvider: "usda",
      sourceExternalId: "173944",
      sourceVersion: "Foundation",
      sourceReference: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
      nutrientSnapshotJson: {
        nutrientsPer100g: {
          caloriesKcal: 89,
          proteinGrams: 1.1,
          carbohydrateGrams: 22.8,
          fatGrams: 0.3,
        },
        servingLabel: "118g confirmed",
        originalNutrientIds: {
          caloriesKcal: "208",
          proteinGrams: "203",
        },
      },
      confidence: {
        identity: "verified",
        portion: "verified",
        nutritionRecord: "high",
        explanation: "Saved from source record.",
      },
      userConfirmed: true,
      preparationMethod: "raw",
      addedOilGrams: 0,
      notes: null,
      createdAt: "2026-07-08T12:00:00.000Z",
      updatedAt: "2026-07-08T12:00:00.000Z",
    };

    const detail = snapshotFoodDetailFromMealItem(item);

    expect(detail.displayName).toBe("Bananas, raw");
    expect(detail.provider).toBe("usda");
    expect(detail.nutrientsPer100g.caloriesKcal).toBe(89);
    expect(detail.originalNutrientIds).toEqual({
      caloriesKcal: "208",
      proteinGrams: "203",
    });
    expect(detail.servingOptions[0]).toMatchObject({
      label: "Logged portion",
      grams: 118,
    });
    expect(detail.provenanceSummary).toContain("Saved meal snapshot");
  });
});
