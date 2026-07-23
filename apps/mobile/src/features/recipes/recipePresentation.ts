import type { MealType, RecipeRead } from "@living-nutrition/shared-types";

export type RecipeFilter = "all" | MealType;
export type RecipeSort = "recent" | "most_used" | "name";

export function filterRecipes(
  recipes: RecipeRead[],
  query: string,
  filter: RecipeFilter,
  folderId?: string | null,
  favoritesOnly = false
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return recipes.filter((recipe) => {
    if (filter !== "all" && (recipe.mealType ?? "meal") !== filter) {
      return false;
    }

    if (folderId !== undefined && recipe.folderId !== folderId) {
      return false;
    }

    if (favoritesOnly && !recipe.isFavorite) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      recipe.name,
      recipe.notes,
      recipe.mealType,
      recipe.folderName,
      ...(recipe.tags ?? []),
      ...recipe.items.map((item) => item.displayName),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
}

export function sortRecipes(recipes: RecipeRead[], sort: RecipeSort) {
  if (sort === "recent") {
    return recipes;
  }

  return [...recipes].sort((left, right) => {
    if (sort === "most_used") {
      return right.timesUsed - left.timesUsed || left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function recipeFilterLabel(filter: RecipeFilter) {
  const labels: Record<RecipeFilter, string> = {
    all: "All",
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    meal: "Any time",
  };

  return labels[filter];
}

export function recipeSortLabel(sort: RecipeSort) {
  const labels: Record<RecipeSort, string> = {
    recent: "Recent",
    most_used: "Most used",
    name: "Name",
  };

  return labels[sort];
}
