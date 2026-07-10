import type { FoodSearchResult } from "@living-nutrition/shared-types";

import {
  buildSavedFoodRemoveActions,
  filterSavedFoods,
  savedFoodFilterLabel,
  savedFoodSortLabel,
  sortSavedFoods,
} from "../savedFoodsPresentation";

describe("saved foods presentation", () => {
  it("filters saved foods by name, brand, provider, data type, and serving text", () => {
    const items = [
      food("food_1", "Greek yogurt", "Living Dairy", "usda", "Branded", "1 cup"),
      food("food_2", "Chicken breast", null, "user", "custom_food", "150g cooked"),
      food("food_3", "Granola bar", "Trail Co", "open_food_facts", "packaged", "1 bar"),
    ];

    expect(filterSavedFoods(items, "yogurt").map((item) => item.id)).toEqual(["food_1"]);
    expect(filterSavedFoods(items, "trail").map((item) => item.id)).toEqual(["food_3"]);
    expect(filterSavedFoods(items, "custom").map((item) => item.id)).toEqual(["food_2"]);
    expect(filterSavedFoods(items, "cup").map((item) => item.id)).toEqual(["food_1"]);
  });

  it("returns all foods for an empty search", () => {
    const items = [food("food_1", "Banana")];

    expect(filterSavedFoods(items, "   ")).toEqual(items);
  });

  it("labels saved-food filters", () => {
    expect(savedFoodFilterLabel("all")).toBe("All");
    expect(savedFoodFilterLabel("favorites")).toBe("Favorites");
    expect(savedFoodFilterLabel("recent")).toBe("Recent");
    expect(savedFoodFilterLabel("custom")).toBe("Custom");
  });

  it("sorts saved foods by name or calories while preserving default order", () => {
    const items = [
      food("food_1", "Greek yogurt", "Living Dairy", "usda", "Branded", "1 cup", 140),
      food("food_2", "apple", null, "usda", "Foundation", "1 medium", 52),
      food("food_3", "Banana", null, "usda", "Foundation", "1 medium", 89),
    ];

    expect(sortSavedFoods(items, "default").map((item) => item.id)).toEqual([
      "food_1",
      "food_2",
      "food_3",
    ]);
    expect(sortSavedFoods(items, "name").map((item) => item.id)).toEqual([
      "food_2",
      "food_3",
      "food_1",
    ]);
    expect(sortSavedFoods(items, "calories").map((item) => item.id)).toEqual([
      "food_2",
      "food_3",
      "food_1",
    ]);
  });

  it("labels saved-food sort options", () => {
    expect(savedFoodSortLabel("default")).toBe("Default");
    expect(savedFoodSortLabel("name")).toBe("Name");
    expect(savedFoodSortLabel("calories")).toBe("Calories");
  });

  it("builds bulk remove actions for visible saved foods", () => {
    const items = [food("food_1", "Banana"), food("food_2", "Rice")];

    expect(buildSavedFoodRemoveActions("recent", items)).toEqual([
      { kind: "recent", foodId: "food_1" },
      { kind: "recent", foodId: "food_2" },
    ]);
  });
});

function food(
  id: string,
  displayName: string,
  brandOwner: string | null = null,
  provider: FoodSearchResult["provider"] = "usda",
  dataType = "Foundation",
  householdServingText: string | null = null,
  caloriesKcal = 100
): FoodSearchResult {
  return {
    id,
    displayName,
    provider,
    externalId: id,
    dataType,
    brandOwner,
    servingSize: 100,
    servingSizeUnit: "g",
    householdServingText,
    nutrientsPer100g: {
      caloriesKcal,
      proteinGrams: 10,
      carbohydrateGrams: 12,
      fatGrams: 3,
    },
    recordConfidence: "high",
    sourceReference: "fixture",
  };
}
