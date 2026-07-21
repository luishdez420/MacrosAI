import { createFixtureQueuedMeal } from "../fixtureMeal";

describe("createFixtureQueuedMeal", () => {
  it("creates a confirmed USDA snapshot suitable for account-scoped queue replay", () => {
    const meal = createFixtureQueuedMeal();
    const [item] = meal.items;

    expect(meal.name).toBe("Fixture queued banana");
    expect(item).toMatchObject({
      foodId: "usda:e2e-banana-raw",
      sourceProvider: "usda",
      sourceExternalId: "e2e-banana-raw",
      consumedGrams: 118,
      userConfirmed: true,
    });
    expect(item.nutrientSnapshotJson).toMatchObject({ fixture: true });
    expect(item.confidence).toMatchObject({
      identity: "verified",
      portion: "verified",
      nutritionRecord: "verified",
    });
  });
});
