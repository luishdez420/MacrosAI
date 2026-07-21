import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApiClientError } from "@living-nutrition/api-client";
import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import type { FoodSearchResult, RecipeRead } from "@living-nutrition/shared-types";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { ManualSearchScreen } from "../ManualSearchScreen";

const mockSearchFoods = jest.fn();
const mockGetFavoriteFoods = jest.fn();
const mockGetRecentFoods = jest.fn();
const mockCreateMeal = jest.fn();
const mockListRecipes = jest.fn();
const mockLogRecipe = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockGetOnboardingPreferences = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockQueueConfirmedMeal = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

jest.mock("../../../shared/domain/mealTiming", () => ({
  suggestMealTypeForTime: () => "lunch",
}));

jest.mock("../../../services/api", () => ({
  api: {
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
    getFavoriteFoods: (...args: unknown[]) => mockGetFavoriteFoods(...args),
    getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
    listRecipes: (...args: unknown[]) => mockListRecipes(...args),
    logRecipe: (...args: unknown[]) => mockLogRecipe(...args),
  },
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  queueConfirmedMeal: (...args: unknown[]) => mockQueueConfirmedMeal(...args),
}));

jest.mock("../../onboarding/onboardingStorage", () => ({
  getOnboardingPreferences: () => mockGetOnboardingPreferences(),
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
    mockListRecipes.mockReset();
    mockLogRecipe.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
    mockGetOnboardingPreferences.mockReset();
    mockGetStoredUserId.mockReset();
    mockQueueConfirmedMeal.mockReset();
    mockNotificationAsync.mockClear();
    mockGetOnboardingPreferences.mockResolvedValue(undefined);
    mockGetStoredUserId.mockResolvedValue("user_1");
    mockQueueConfirmedMeal.mockResolvedValue(undefined);
    mockListRecipes.mockResolvedValue([]);
  });

  afterEach(async () => {
    // TanStack Query schedules observer notifications after mutations settle.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
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
    expect(view.getByLabelText("Search foods by name")).toBeTruthy();
    expect(view.getByLabelText("Manage saved favorite and recent foods")).toBeTruthy();
    expect(view.getByLabelText("Select Bananas, raw nutrition record").props.accessibilityState.selected).toBe(false);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Select Bananas, raw nutrition record"));
    });

    expect(view.getByText("Selected food")).toBeTruthy();
    expect(view.getByText("Number of servings")).toBeTruthy();
    expect(view.getByText("1 serving = 118g from the source record.")).toBeTruthy();
    expect(view.getAllByText("View source").length).toBeGreaterThan(0);
    expect(view.getByText("Log meal")).toBeTruthy();
    expect(view.getByLabelText("Number of servings")).toBeTruthy();
    expect(view.getByLabelText("Choose a different food instead of Bananas, raw")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Log meal"));
    });

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });
    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByText("View Today"));
    });
    expect(mockReplace).toHaveBeenCalledWith("/");

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

  it("queues a confirmed manual meal after a network failure without claiming it was logged", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [bananaFood] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockCreateMeal.mockRejectedValueOnce(
      new ApiClientError("Cannot reach the nutrition API.", {
        status: 0,
        code: "network_unavailable",
      })
    );

    const view = await renderWithQueryClient(<ManualSearchScreen />);
    await view.findByText("Favorite foods");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Select Bananas, raw nutrition record"));
    });
    await view.findByText("Log meal");
    await act(async () => {
      fireEvent.press(view.getByText("Log meal"));
    });

    await waitFor(() => {
      expect(mockQueueConfirmedMeal).toHaveBeenCalledWith(
        "user_1",
        expect.objectContaining({ name: "Bananas, raw" }),
        expect.stringMatching(/^manual-/)
      );
      expect(view.getByText("Confirmed meal queued")).toBeTruthy();
      expect(view.getByText(/saved on this device/)).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
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
    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
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

  it("defaults scale-first onboarding users to grams for verified foods", async () => {
    mockGetOnboardingPreferences.mockResolvedValue({
      goalPreference: "track_macros",
      loggingPreference: "kitchen_scale",
    });
    mockGetFavoriteFoods.mockResolvedValue({ items: [bananaFood] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await waitFor(() => expect(view.getByText("Bananas, raw")).toBeTruthy());
    await waitFor(() => expect(mockGetOnboardingPreferences).toHaveBeenCalledTimes(1));
    fireEvent.press(view.getByText("Bananas, raw"));

    await waitFor(() => {
      expect(view.getByText("Weight in grams")).toBeTruthy();
      expect(view.queryByText("Number of servings")).toBeNull();
    });
  });

  it("explains provider outages and offers a retry instead of presenting an empty result list", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockSearchFoods.mockRejectedValue(
      new ApiClientError("Nutrition records are temporarily unavailable.", {
        status: 503,
        code: "nutrition_provider_unavailable",
        requestId: "request_fixture_1",
      })
    );

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Search foods by name"), "fixture provider outage");
    });

    expect(await view.findByText("Nutrition search is temporarily unavailable")).toBeTruthy();
    expect(
      view.getByText(
        "Nutrition records are temporarily unavailable. Please try again shortly. Reference: request_fixture_1."
      )
    ).toBeTruthy();
    expect(view.queryByText("No foods found yet.")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByText("Try search again"));
    });

    await waitFor(() => {
      expect(mockSearchFoods).toHaveBeenCalledTimes(2);
    });
  });

  it("explains a rate limit and retains the retry action instead of presenting an empty result list", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockSearchFoods.mockRejectedValue(
      new ApiClientError("Too many requests. Please wait and try again.", {
        status: 429,
        code: "rate_limited",
        requestId: "request_rate_limit_1",
      })
    );

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Search foods by name"), "fixture rate limit");
    });

    expect(await view.findByText("Nutrition search is temporarily unavailable")).toBeTruthy();
    expect(
      view.getByText(
        "Too many requests were sent. Wait a moment, then try again. Reference: request_rate_limit_1."
      )
    ).toBeTruthy();
    expect(view.queryByText("No foods found yet.")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByText("Try search again"));
    });

    await waitFor(() => {
      expect(mockSearchFoods).toHaveBeenCalledTimes(2);
    });
  });

  it("surfaces a user-saved recipe for the current meal period and logs its saved snapshot", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });
    mockListRecipes.mockResolvedValue([lunchRecipe()]);
    mockLogRecipe.mockResolvedValue({ recipe: lunchRecipe(), meal: { id: "meal_from_recipe" } });

    const view = await renderWithQueryClient(<ManualSearchScreen />);

    await waitFor(() => {
      expect(view.getByText("Saved for lunch")).toBeTruthy();
      expect(view.getByText("Chicken and rice lunch")).toBeTruthy();
    });
    expect(view.getByText(/Your recipes tagged for this time of day/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Log saved meal"));
    });

    await waitFor(() => {
      expect(mockLogRecipe).toHaveBeenCalledWith(
        "recipe_lunch",
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^recipe-log-/) })
      );
    });
    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("uses semantic dark-theme colors for manual actions and input placeholders", async () => {
    mockGetFavoriteFoods.mockResolvedValue({ items: [bananaFood] });
    mockGetRecentFoods.mockResolvedValue({ items: [] });

    const view = await renderWithQueryClient(<ManualSearchScreen />, "dark");

    await view.findByText("Favorite foods");
    expect(StyleSheet.flatten(view.getByText("Manage saved foods").props.style)?.color).toBe(
      themePalettes.dark.actionText
    );
    expect(view.getByLabelText("Search foods by name").props.placeholderTextColor).toBe(
      themePalettes.dark.muted
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText("Select Bananas, raw nutrition record"));
    });

    expect(StyleSheet.flatten(view.getAllByText("View source")[0].props.style)?.color).toBe(
      themePalettes.dark.actionText
    );
    expect(view.getByLabelText("Number of servings").props.placeholderTextColor).toBe(
      themePalettes.dark.muted
    );
  });
});

function lunchRecipe(): RecipeRead {
  return {
    id: "recipe_lunch",
    name: "Chicken and rice lunch",
    mealType: "lunch",
    notes: null,
    timesUsed: 3,
    createdAt: "2026-07-12T12:00:00Z",
    updatedAt: "2026-07-12T12:00:00Z",
    items: [
      {
        id: "recipe_item_1",
        foodId: "usda:123",
        displayName: "Chicken and rice",
        consumedGrams: 320,
        servingQuantity: 320,
        servingUnit: "grams",
        calories: 510,
        proteinGrams: 42,
        carbohydrateGrams: 58,
        fatGrams: 11,
        fiberGrams: 4,
        sugarGrams: 2,
        sodiumMilligrams: 380,
        sourceProvider: "usda",
        sourceExternalId: "123",
        sourceVersion: "FNDDS",
        sourceReference: "USDA fixture",
        nutrientSnapshotJson: {},
        confidence: {
          identity: "verified",
          portion: "verified",
          nutritionRecord: "high",
          explanation: "Saved recipe fixture.",
        },
        userConfirmed: true,
        preparationMethod: "grilled",
        addedOilGrams: 0,
        notes: null,
        createdAt: "2026-07-12T12:00:00Z",
        updatedAt: "2026-07-12T12:00:00Z",
      },
    ],
  };
}

function renderWithQueryClient(element: ReactElement, themePreference: ThemePreference = "light") {
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
      <ThemeProvider initialPreference={themePreference}>
        <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
