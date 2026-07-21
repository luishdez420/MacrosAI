import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { colors, spacing } from "@living-nutrition/design-tokens";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { FoodSearchResult } from "@living-nutrition/shared-types";
import { SavedFoodsScreen } from "../SavedFoodsScreen";

const mockGetFavoriteFoods = jest.fn();
const mockGetRecentFoods = jest.fn();
const mockGetCustomFoods = jest.fn();
const mockRemoveFavoriteFood = jest.fn();
const mockRemoveRecentFood = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactElement }) => children,
}));

jest.mock("../../../services/api", () => ({
  api: {
    getFavoriteFoods: (...args: unknown[]) => mockGetFavoriteFoods(...args),
    getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
    getCustomFoods: (...args: unknown[]) => mockGetCustomFoods(...args),
    removeFavoriteFood: (...args: unknown[]) => mockRemoveFavoriteFood(...args),
    removeRecentFood: (...args: unknown[]) => mockRemoveRecentFood(...args),
  },
}));

describe("SavedFoodsScreen", () => {
  beforeEach(() => {
    mockGetFavoriteFoods.mockReset();
    mockGetRecentFoods.mockReset();
    mockGetCustomFoods.mockReset();
    mockRemoveFavoriteFood.mockReset();
    mockRemoveRecentFood.mockReset();
  });

  it("filters saved records and retains accessible source-review actions", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [food("favorite_1", "Greek yogurt")] });
    mockGetRecentFoods.mockResolvedValue({ items: [food("recent_1", "Brown rice")] });
    mockGetCustomFoods.mockResolvedValue({ items: [food("custom_1", "My smoothie", "user")] });

    const view = await renderWithQueryClient(<SavedFoodsScreen />);

    await waitFor(() => {
      expect(view.getByText("Greek yogurt")).toBeTruthy();
      expect(view.getByText("Brown rice")).toBeTruthy();
      expect(view.getByText("My smoothie")).toBeTruthy();
    });

    fireEvent.changeText(view.getByLabelText("Search saved foods"), "smoothie");

    await waitFor(() => {
      expect(view.getByText("My smoothie")).toBeTruthy();
      expect(view.queryByText("Greek yogurt")).toBeNull();
    });
    expect(view.getByLabelText("View nutrition source for My smoothie")).toBeTruthy();
    expect(view.getByLabelText("Show All saved foods").props.accessibilityState.selected).toBe(true);

    fireEvent.press(view.getByLabelText("Show Custom saved foods"));

    await waitFor(() => {
      expect(view.getByLabelText("Show Custom saved foods").props.accessibilityState.selected).toBe(true);
    });
    expect(view.getByLabelText("Sort saved foods by Default").props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText("Edit custom My smoothie")).toBeTruthy();
    expect(view.getByLabelText("Return to manual food search")).toBeTruthy();
  });

  it("uses the shared selected color and separates a bulk action from recent foods", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
    mockGetRecentFoods.mockResolvedValue({ items: [food("recent_1", "Brown rice")] });
    mockGetCustomFoods.mockResolvedValue({ items: [] });

    const view = await renderWithQueryClient(<SavedFoodsScreen />);

    await waitFor(() => {
      expect(view.getByText("Brown rice")).toBeTruthy();
    });

    expect(StyleSheet.flatten(view.getByLabelText("Sort saved foods by Default").props.style)).toMatchObject({
      backgroundColor: colors.green,
    });
    expect(StyleSheet.flatten(view.getByLabelText("Clear visible recents").props.style)).toMatchObject({
      marginBottom: spacing.sm,
    });
    expect(StyleSheet.flatten(view.getByTestId("saved-food-filter-controls").props.style)).toMatchObject({
      marginTop: spacing.sm,
    });
  });
});

function food(
  id: string,
  displayName: string,
  provider: FoodSearchResult["provider"] = "usda"
): FoodSearchResult {
  return {
    id,
    displayName,
    provider,
    externalId: id,
    dataType: provider === "user" ? "custom_food" : "Foundation",
    brandOwner: null,
    servingSize: 100,
    servingSizeUnit: "g",
    householdServingText: "100 grams",
    nutrientsPer100g: {
      caloriesKcal: 100,
      proteinGrams: 10,
      carbohydrateGrams: 12,
      fatGrams: 3,
    },
    recordConfidence: "high",
    sourceReference: "fixture",
  };
}

async function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </SafeAreaProvider>
  );
}
