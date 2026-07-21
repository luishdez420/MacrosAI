import type { MealCreate } from "@living-nutrition/shared-types";

/** A valid 1x1 PNG used only by the dedicated automated-test build. */
export const fixtureMealPhoto = {
  uri: "e2e-fixture://grilled-chicken.png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLwYQAAAABJRU5ErkJggg==",
  source: "library" as const,
};

/** Source-backed snapshot used only to exercise the SQLite queue and replay path. */
export function createFixtureQueuedMeal(): MealCreate {
  return {
    name: "Fixture queued banana",
    mealType: "snack",
    loggedAt: new Date().toISOString(),
    notes: "Automated offline-queue fixture.",
    items: [
      {
        foodId: "usda:e2e-banana-raw",
        displayName: "Banana, raw",
        consumedGrams: 118,
        servingQuantity: 1,
        servingUnit: "medium banana",
        calories: 105.02,
        proteinGrams: 1.2862,
        carbohydrateGrams: 26.9512,
        fatGrams: 0.3894,
        fiberGrams: 3.068,
        sugarGrams: 14.4314,
        sodiumMilligrams: 1.18,
        sourceProvider: "usda",
        sourceExternalId: "e2e-banana-raw",
        sourceVersion: null,
        sourceReference: "https://fdc.nal.usda.gov/",
        nutrientSnapshotJson: {
          fixture: true,
          nutrientsPer100g: {
            caloriesKcal: 89,
            proteinGrams: 1.09,
            carbohydrateGrams: 22.84,
            fatGrams: 0.33,
          },
        },
        confidence: {
          identity: "verified",
          portion: "verified",
          nutritionRecord: "verified",
          explanation: "Deterministic device-test fixture.",
        },
        userConfirmed: true,
        preparationMethod: null,
        addedOilGrams: 0,
        notes: null,
      },
    ],
  };
}
