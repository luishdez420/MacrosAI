import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { FoodSearchResult } from "@living-nutrition/shared-types";
import { ManualSearchScreen } from "../ManualSearchScreen";

const mockSearchFoods = jest.fn();
const mockGetFavoriteFoods = jest.fn();
const mockGetRecentFoods = jest.fn();
const mockCreateMeal = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
    getFavoriteFoods: (...args: unknown[]) => mockGetFavoriteFoods(...args),
    getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
}));

const bananaFood: FoodSearchResult = {
  id: "usda:173944",
  displayName: "Bananas, raw",
  provider: "usda",
  externalId: "173944",
  dataType: "Foundation",
  brandOwner: null,
  publicationDate: "2020-10-30",
  servingSize: 118,
  servingSizeUnit: "g",
  householdServingText: "1 medium banana",
  nutrientsPer100g: {
    caloriesKcal: 89,
    proteinGrams: 1.1,
    carbohydrateGrams: 22.8,
    fatGrams: 0.3,
    fiberGrams: 2.6,
    sugarGrams: 12.2,
    sodiumMilligrams: 1,
  },
  originalNutrientIds: {
    caloriesKcal: "1008",
    proteinGrams: "1003",
    carbohydrateGrams: "1005",
    fatGrams: "1004",
  },
  qualityFlags: [],
  recordConfidence: "high",
  sourceReference: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
  retrievedAt: "2026-07-08T12:00:00Z",
};

const foodWithoutVerifiedServing: FoodSearchResult = {
  ...bananaFood,
  id: "usda:unverified-serving",
  displayName: "Prepared food without a verified gram serving",
  servingSize: null,
  servingSizeUnit: null,
  householdServingText: "1 bowl",
};

describe("ManualSearchScreen", () => {
  beforeEach(() => {
    mockSearchFoods.mockReset();
    mockGetFavoriteFoods.mockReset();
    mockGetRecentFoods.mockReset();
    mockCreateMeal.mockReset();
    mockReplace.mockReset();
  });

  it("reveals portion controls and the sticky log action after selecting a saved food", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [bananaFood] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockCreateMeal.mockResolvedValueOnce({
      id: "meal_1",
      name: "Bananas, raw",
      loggedAt: "2026-07-08T12:00:00Z",
      notes: null,
      items: [],
      createdAt: "2026-07-08T12:00:00Z",
      updatedAt: "2026-07-08T12:00:00Z",
    });

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await waitFor(() => {
      expect(view.getByText("Favorite foods")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByText("Bananas, raw"));
    });

    expect(view.getByText("Selected food")).toBeTruthy();
    expect(view.getByText("Number of servings")).toBeTruthy();
    expect(view.getByText("1 serving = 118g from the source record.")).toBeTruthy();
    expect(view.getAllByText("View source").length).toBeGreaterThan(0);
    expect(view.getByText("Log meal")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Log meal"));
    });

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    expect(mockCreateMeal.mock.calls[0]?.[0]).toMatchObject({
      name: "Bananas, raw",
      items: [
        {
          foodId: "usda:173944",
          consumedGrams: 118,
          servingQuantity: 1,
          servingUnit: "serving",
          sourceProvider: "usda",
          sourceExternalId: "173944",
        },
      ],
    });
  });

  it("logs an ounce amount using converted grams while retaining the entered unit", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [bananaFood] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockCreateMeal.mockResolvedValueOnce({ id: "meal_ounces" });

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await waitFor(() => {
      expect(view.getByText("Bananas, raw")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Bananas, raw"));
    });
    await act(async () => {
      fireEvent.press(view.getByText("Ounces"));
    });

    expect(view.getByText("Weight in ounces")).toBeTruthy();
    const amountInput = view.getByPlaceholderText("3.5");
    fireEvent.changeText(amountInput, "2");
    await waitFor(() => {
      expect(view.getByDisplayValue("2")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Log meal"));
    });

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockCreateMeal.mock.calls[0]?.[0]).toMatchObject({
      items: [
        {
          consumedGrams: 56.69904625,
          servingQuantity: 2,
          servingUnit: "ounces",
        },
      ],
    });
  });

  it("does not infer a 100g serving when the source has no verified gram weight", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [foodWithoutVerifiedServing] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await waitFor(() => {
      expect(view.getByText("Prepared food without a verified gram serving")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Prepared food without a verified gram serving"));
    });

    expect(view.getByText("Weight in grams")).toBeTruthy();
    expect(
      view.getByText(
        "Servings are unavailable because this record has no verified gram weight. Use grams or ounces."
      )
    ).toBeTruthy();
    expect(
      view.getByLabelText("Servings unavailable because no verified gram serving weight").props
        .accessibilityState.disabled
    ).toBe(true);
  });
});

function renderWithQueryClient(element: ReactElement) {
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
      <QueryClientProvider client={queryClient}>
        {element}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
