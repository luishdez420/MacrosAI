import {
  createMealFromFood,
  gramsForPortion,
  portionAmountForGrams,
  portionInputLabel,
  portionLabel,
} from "../foodLogging";
import type { FoodSearchResult } from "@living-nutrition/shared-types";

describe("food logging portions", () => {
  it("converts ounces to grams before nutrition calculations", () => {
    expect(gramsForPortion("ounces", "2", 100)).toBeCloseTo(56.69904625, 8);
    expect(portionLabel("ounces", "2", 100)).toBe("2 oz (56.7g)");
  });

  it("preserves a portion approximately when switching between grams and ounces", () => {
    expect(portionAmountForGrams("ounces", 100, 100)).toBe("3.527");
    expect(gramsForPortion("ounces", portionAmountForGrams("ounces", 100, 100), 100)).toBeCloseTo(
      100,
      1
    );
  });

  it("keeps serving labels separate from weight labels", () => {
    expect(portionInputLabel("grams")).toBe("Weight in grams");
    expect(portionInputLabel("ounces")).toBe("Weight in ounces");
    expect(portionInputLabel("servings")).toBe("Number of servings");
  });

  it("refuses to infer grams for a serving without a verified gram weight", () => {
    expect(gramsForPortion("servings", "1", undefined)).toBe(0);
    expect(portionAmountForGrams("servings", 100, undefined)).toBe("");
    expect(portionLabel("servings", "1", undefined)).toBe(
      "1 serving (gram weight not verified)"
    );
  });

  it("preserves the source quality assessment in a newly logged meal snapshot", () => {
    const meal = createMealFromFood({
      food: qualityAssessedFood(),
      grams: 150,
      servingLabel: "150g",
      nutrients: {
        caloriesKcal: 165,
        proteinGrams: 31,
        carbohydrateGrams: 0,
        fatGrams: 3.6,
      },
      servingQuantity: 150,
      portionMode: "grams",
      source: "manual",
    });

    expect(meal.items[0]?.nutrientSnapshotJson).toMatchObject({
      qualityAssessment: {
        status: "needs_review",
        signals: ["provider_record", "stale_source"],
        isBlocking: false,
      },
    });
  });
});

function qualityAssessedFood(): FoodSearchResult {
  return {
    id: "usda:chicken",
    displayName: "Chicken breast, roasted",
    provider: "usda",
    externalId: "chicken",
    dataType: "Foundation",
    brandOwner: null,
    nutrientsPer100g: {
      caloriesKcal: 110,
      proteinGrams: 20.7,
      carbohydrateGrams: 0,
      fatGrams: 2.4,
    },
    qualityFlags: ["stale_source_record"],
    qualityAssessment: {
      status: "needs_review",
      signals: ["provider_record", "stale_source"],
      summary: "The cached source is stale. Review before logging.",
      isBlocking: false,
    },
    recordConfidence: "medium",
    sourceReference: "USDA fixture",
  };
}
