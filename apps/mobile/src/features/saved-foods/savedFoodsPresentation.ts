import type { FoodSearchResult } from "@living-nutrition/shared-types";

export type SavedFoodFilter = "all" | "favorites" | "recent" | "custom";
export type SavedFoodRemovalKind = "favorite" | "recent";
export type SavedFoodSort = "default" | "name" | "calories";

export type SavedFoodRemoveAction = {
  kind: SavedFoodRemovalKind;
  foodId: string;
};

export function filterSavedFoods(items: FoodSearchResult[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return items;
  }

  return items.filter((item) => {
    const searchableText = [
      item.displayName,
      item.brandOwner,
      item.provider,
      item.dataType,
      item.householdServingText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

export function savedFoodFilterLabel(filter: SavedFoodFilter) {
  switch (filter) {
    case "favorites":
      return "Favorites";
    case "recent":
      return "Recent";
    case "custom":
      return "Custom";
    default:
      return "All";
  }
}

export function sortSavedFoods(items: FoodSearchResult[], sort: SavedFoodSort) {
  if (sort === "default") {
    return items;
  }

  return [...items].sort((left, right) => {
    if (sort === "calories") {
      return left.nutrientsPer100g.caloriesKcal - right.nutrientsPer100g.caloriesKcal;
    }

    return left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    });
  });
}

export function savedFoodSortLabel(sort: SavedFoodSort) {
  switch (sort) {
    case "name":
      return "Name";
    case "calories":
      return "Calories";
    default:
      return "Default";
  }
}

export function buildSavedFoodRemoveActions(
  kind: SavedFoodRemovalKind,
  items: FoodSearchResult[]
): SavedFoodRemoveAction[] {
  return items.map((item) => ({
    kind,
    foodId: item.id,
  }));
}
