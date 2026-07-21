import type { MealCreate } from "@living-nutrition/shared-types";

import { mealCreateIdempotencyKey } from "../../../shared/domain/mealIdempotency";

const meal: MealCreate = {
  name: "Chicken plate",
  notes: "Camera-assisted review.",
  items: [
    {
      foodId: "usda:123",
      displayName: "Chicken breast",
      consumedGrams: 145,
      calories: 240,
      proteinGrams: 45,
      carbohydrateGrams: 0,
      fatGrams: 5,
      sourceProvider: "usda",
      sourceExternalId: "123",
      nutrientSnapshotJson: {},
      confidence: {
        identity: "verified",
        portion: "verified",
        nutritionRecord: "high",
        explanation: "Confirmed source and portion.",
      },
      userConfirmed: true,
      addedOilGrams: 0,
    },
  ],
};

describe("mealCreateIdempotencyKey", () => {
  it("keeps retries of the same reviewed meal on one key", () => {
    expect(mealCreateIdempotencyKey("analysis_1", meal)).toBe(
      mealCreateIdempotencyKey("analysis_1", meal)
    );
  });

  it("changes the key when a confirmed portion changes", () => {
    const adjustedMeal: MealCreate = {
      ...meal,
      items: [{ ...meal.items[0], consumedGrams: 180 }],
    };

    expect(mealCreateIdempotencyKey("analysis_1", adjustedMeal)).not.toBe(
      mealCreateIdempotencyKey("analysis_1", meal)
    );
  });
});
