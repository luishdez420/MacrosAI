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
      ...(item.savedTags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}

export function savedFoodTags(items: FoodSearchResult[]) {
  const tagsByNormalizedName = new Map<string, string>();

  for (const item of items) {
    for (const tag of item.savedTags ?? []) {
      const cleaned = tag.trim();
      if (cleaned) {
        const normalizedName = cleaned.toLocaleLowerCase();
        if (!tagsByNormalizedName.has(normalizedName)) {
          tagsByNormalizedName.set(normalizedName, cleaned);
        }
      }
    }
  }

  return [...tagsByNormalizedName.values()].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );
}

export function filterSavedFoodsByTag(items: FoodSearchResult[], tag: string | null) {
  if (!tag) {
    return items;
  }

  const normalizedTag = tag.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (item.savedTags ?? []).some((itemTag) => itemTag.trim().toLocaleLowerCase() === normalizedTag)
  );
}

export function parseSavedFoodTags(value: string) {
  const normalizedTags = new Map<string, string>();

  for (const tag of value.split(",")) {
    const cleaned = tag.trim();
    if (cleaned) {
      const normalizedTag = cleaned.toLocaleLowerCase();
      if (!normalizedTags.has(normalizedTag)) {
        normalizedTags.set(normalizedTag, cleaned);
      }
    }
  }

  return [...normalizedTags.values()].slice(0, 10);
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
