import type { FoodQualityAssessment, FoodSearchResult } from "@living-nutrition/shared-types";

import { blocksFoodLogging, foodQualityDisplay, foodQualitySignals } from "../foodQuality";

const completeFood: FoodSearchResult = {
  id: "usda:banana",
  displayName: "Bananas, raw",
  provider: "usda",
  externalId: "banana",
  dataType: "Foundation",
  brandOwner: null,
  nutrientsPer100g: {
    caloriesKcal: 89,
    proteinGrams: 1.1,
    carbohydrateGrams: 22.8,
    fatGrams: 0.3,
  },
  recordConfidence: "high",
  sourceReference: "https://fdc.nal.usda.gov/",
  qualityAssessment: {
    status: "complete",
    signals: ["provider_record"],
    summary: "Basic checks passed.",
    isBlocking: false,
  },
};

describe("food quality presentation", () => {
  it("renders a non-blocking provider record as basic checks passed", () => {
    expect(foodQualityDisplay(completeFood.qualityAssessment)).toMatchObject({
      label: "Basic checks passed",
      tone: "success",
    });
    expect(blocksFoodLogging(completeFood)).toBe(false);
  });

  it("blocks records with incomplete essential per-100g data", () => {
    const qualityAssessment: FoodQualityAssessment = {
      status: "insufficient_data",
      signals: ["provider_record", "incomplete_data"],
      summary: "Core nutrients are missing.",
      isBlocking: true,
    };
    const food = {
      ...completeFood,
      qualityAssessment,
    };

    expect(foodQualityDisplay(food.qualityAssessment)).toMatchObject({
      label: "Insufficient data",
      tone: "danger",
    });
    expect(foodQualitySignals(food.qualityAssessment)).toBe(
      "provider record, incomplete per-100g data"
    );
    expect(blocksFoodLogging(food)).toBe(true);
  });

  it("keeps saved snapshots without the newer assessment reviewable", () => {
    expect(foodQualityDisplay(undefined)).toMatchObject({
      label: "Source review recommended",
      tone: "warning",
    });
    expect(blocksFoodLogging({ qualityAssessment: undefined })).toBe(false);
  });
});
