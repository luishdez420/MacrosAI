import type { RecipeRead } from "@living-nutrition/shared-types";

import {
  filterRecipes,
  recipeFilterLabel,
  recipeSortLabel,
  sortRecipes,
} from "../recipePresentation";

describe("recipe presentation", () => {
  const recipes = [
    recipe("recipe_1", "Chicken rice bowl", "lunch", 3, ["Chicken breast", "Cooked rice"]),
    recipe("recipe_2", "Berry oats", "breakfast", 7, ["Oats", "Blueberries"]),
    recipe("recipe_3", "Anytime smoothie", "meal", 1, ["Greek yogurt", "Banana"]),
  ];

  it("filters recipes by meal time and searchable ingredients", () => {
    expect(filterRecipes(recipes, "blueberries", "all").map((recipe) => recipe.id)).toEqual(["recipe_2"]);
    expect(filterRecipes(recipes, "", "lunch").map((recipe) => recipe.id)).toEqual(["recipe_1"]);
    expect(filterRecipes(recipes, "smoothie", "breakfast")).toEqual([]);
    expect(filterRecipes([{ ...recipes[0], tags: ["Weekday"] }], "weekday", "all").map((recipe) => recipe.id)).toEqual(["recipe_1"]);
    expect(filterRecipes([{ ...recipes[0], folderId: "folder_1", folderName: "Weeknight" }], "", "all", "folder_1").map((recipe) => recipe.id)).toEqual(["recipe_1"]);
    expect(filterRecipes([{ ...recipes[0], folderId: null }], "", "all", null).map((recipe) => recipe.id)).toEqual(["recipe_1"]);
    expect(filterRecipes([{ ...recipes[0], isFavorite: true }, recipes[1]], "", "all", undefined, true).map((recipe) => recipe.id)).toEqual(["recipe_1"]);
  });

  it("keeps recent order or sorts recipes predictably", () => {
    expect(sortRecipes(recipes, "recent").map((recipe) => recipe.id)).toEqual([
      "recipe_1",
      "recipe_2",
      "recipe_3",
    ]);
    expect(sortRecipes(recipes, "most_used").map((recipe) => recipe.id)).toEqual([
      "recipe_2",
      "recipe_1",
      "recipe_3",
    ]);
    expect(sortRecipes(recipes, "name").map((recipe) => recipe.id)).toEqual([
      "recipe_3",
      "recipe_2",
      "recipe_1",
    ]);
  });

  it("uses user-facing filter and sort labels", () => {
    expect(recipeFilterLabel("meal")).toBe("Any time");
    expect(recipeSortLabel("most_used")).toBe("Most used");
  });
});

function recipe(
  id: string,
  name: string,
  mealType: RecipeRead["mealType"],
  timesUsed: number,
  ingredientNames: string[]
): RecipeRead {
  return {
    id,
    name,
    mealType,
    notes: null,
    timesUsed,
    createdAt: "2026-07-22T12:00:00Z",
    updatedAt: "2026-07-22T12:00:00Z",
    items: ingredientNames.map((displayName, index) => ({
      id: `${id}-${index}`,
      foodId: `usda:${index}`,
      displayName,
      consumedGrams: 100,
      servingQuantity: 100,
      servingUnit: "grams",
      calories: 100,
      proteinGrams: 10,
      carbohydrateGrams: 10,
      fatGrams: 5,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
      sourceProvider: "usda",
      sourceExternalId: String(index),
      sourceVersion: null,
      confidence: {
        identity: "high",
        portion: "high",
        nutritionRecord: "high",
        explanation: "Fixture",
      },
      userConfirmed: true,
      preparationMethod: null,
      addedOilGrams: 0,
      notes: null,
      nutrientSnapshotJson: {},
      createdAt: "2026-07-22T12:00:00Z",
      updatedAt: "2026-07-22T12:00:00Z",
    })),
  };
}
