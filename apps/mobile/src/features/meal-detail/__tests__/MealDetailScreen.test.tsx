import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import type { FoodSearchResult, MealRead } from "@living-nutrition/shared-types";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { MealDetailScreen } from "../MealDetailScreen";

const mockGetMeal = jest.fn();
const mockUpdateMeal = jest.fn();
const mockDeleteMeal = jest.fn();
const mockSearchFoods = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactElement }) => children,
  useLocalSearchParams: () => ({ id: "meal_1" }),
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getMeal: (...args: unknown[]) => mockGetMeal(...args),
    updateMeal: (...args: unknown[]) => mockUpdateMeal(...args),
    deleteMeal: (...args: unknown[]) => mockDeleteMeal(...args),
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
  },
}));

describe("MealDetailScreen", () => {
  beforeEach(() => {
    mockGetMeal.mockReset();
    mockUpdateMeal.mockReset();
    mockDeleteMeal.mockReset();
    mockSearchFoods.mockReset();
    mockBack.mockReset();
    mockReplace.mockReset();
    mockNotificationAsync.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  });

  it("recalculates a saved portion and preserves the source-review entry point", async () => {
    const meal = savedMeal();
    mockGetMeal.mockResolvedValue(meal);
    mockUpdateMeal.mockResolvedValue(meal);

    const view = await renderWithQueryClient(<MealDetailScreen />);

    const gramsInput = await view.findByLabelText("Actual grams eaten for Bananas, raw");
    await act(async () => {
      fireEvent.changeText(gramsInput, "150");
    });

    expect(view.getAllByText("134 kcal")).toHaveLength(2);
    expect(
      view.getByLabelText("Fiber: 3.9 g, based on the portion entered")
    ).toBeTruthy();
    expect(
      view.getByLabelText("Sodium: 2 mg, based on the portion entered")
    ).toBeTruthy();
    expect(view.getByLabelText("View nutrition source for Bananas, raw")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Save adjusted meal"));
    });

    await waitFor(() => {
      expect(mockUpdateMeal).toHaveBeenCalledWith(
        "meal_1",
        expect.objectContaining({
          loggedAt: "2026-07-12T12:30:00.000Z",
          items: [expect.objectContaining({ consumedGrams: 150 })],
        })
      );
    });
    expect(await view.findByText("Meal updated.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(view.getByText("View Today"));

    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("uses in-app confirmation before deletion and shows a completion state", async () => {
    mockGetMeal.mockResolvedValue(savedMeal());
    mockDeleteMeal.mockResolvedValue(undefined);

    const view = await renderWithQueryClient(<MealDetailScreen />);

    await view.findByText("Lunch");
    fireEvent.press(view.getByLabelText("Delete meal"));

    expect(await view.findByText("Delete Lunch?")).toBeTruthy();
    expect(view.getByText(/This cannot be undone/)).toBeTruthy();
    expect(mockDeleteMeal).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getAllByLabelText("Delete meal")[1]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(mockDeleteMeal).toHaveBeenCalledWith("meal_1"));
    expect(await view.findByText("Meal deleted.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("replaces a saved food with a selected provider record before persisting the meal", async () => {
    mockGetMeal.mockResolvedValue(savedMeal());
    mockSearchFoods.mockResolvedValue({ items: [replacementFood()] });
    mockUpdateMeal.mockResolvedValue(savedMeal());

    const view = await renderWithQueryClient(<MealDetailScreen />);

    await view.findByText("Lunch");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Search for a replacement for Bananas, raw"));
    });
    await view.findByLabelText("Search food records to replace Bananas, raw");
    await act(async () => {
      fireEvent.changeText(
        view.getByLabelText("Search food records to replace Bananas, raw"),
        "plantain"
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(mockSearchFoods).toHaveBeenCalledWith("plantain"));
    fireEvent.press(await view.findByLabelText("Use Plantains, raw as the replacement food"));

    expect(await view.findByText("Replacement ready to save")).toBeTruthy();
    expect(view.getByText(/recalculated from the selected record and grams entered/i)).toBeTruthy();
    expect(view.getAllByText("122 kcal")).toHaveLength(2);

    await act(async () => {
      fireEvent.press(view.getByText("Save adjusted meal"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockUpdateMeal).toHaveBeenCalledWith(
        "meal_1",
        expect.objectContaining({
          items: [
            expect.objectContaining({
              foodId: "usda:plantain",
              displayName: "Plantains, raw",
              calories: 122,
              sourceProvider: "usda",
              nutrientSnapshotJson: expect.objectContaining({
                replacement: expect.objectContaining({ previousFoodId: "usda:173944" }),
              }),
            }),
          ],
        })
      );
    });
  });

  it("adds a provider-backed food and removes an incorrect saved item before persisting", async () => {
    mockGetMeal.mockResolvedValue(savedMeal());
    mockSearchFoods.mockResolvedValue({ items: [addedFood()] });
    mockUpdateMeal.mockResolvedValue(savedMeal());

    const view = await renderWithQueryClient(<MealDetailScreen />);

    await view.findByText("Lunch");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add another food to this meal"));
    });
    const addFoodInput = await view.findByLabelText("Search provider records to add to this meal");
    await act(async () => {
      fireEvent.changeText(
        addFoodInput,
        "oatmeal"
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(mockSearchFoods).toHaveBeenCalledWith("oatmeal"));
    fireEvent.press(await view.findByLabelText("Add Oatmeal, cooked to this meal"));

    expect(await view.findByText("Added")).toBeTruthy();
    fireEvent.press(view.getByLabelText("Remove Bananas, raw from this meal"));
    expect(await view.findByText("1 food removed")).toBeTruthy();
    expect(view.getByText(/will stay out of this meal when you save/i)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Save adjusted meal"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockUpdateMeal).toHaveBeenCalledWith(
        "meal_1",
        expect.objectContaining({
          items: [
            expect.objectContaining({
              foodId: "usda:oatmeal",
              displayName: "Oatmeal, cooked",
              consumedGrams: 100,
              calories: 68,
              nutrientSnapshotJson: expect.objectContaining({
                addedDuringMealEditAt: expect.any(String),
              }),
            }),
          ],
        })
      );
    });
  });

  it("uses semantic dark-theme colors for saved-meal actions and editable fields", async () => {
    mockGetMeal.mockResolvedValue(savedMeal());

    const view = await renderWithQueryClient(<MealDetailScreen />, "dark");

    await view.findByText("Lunch");
    expect(StyleSheet.flatten(view.getByText("Close").props.style)?.color).toBe(
      themePalettes.dark.actionText
    );
    expect(view.getByLabelText("Meal date in year month day format").props.placeholderTextColor).toBe(
      themePalettes.dark.muted
    );
    expect(StyleSheet.flatten(view.getByText("View source").props.style)?.color).toBe(
      themePalettes.dark.actionText
    );
  });
});

function savedMeal(): MealRead {
  return {
    id: "meal_1",
    name: "Lunch",
    mealType: "lunch",
    loggedAt: "2026-07-12T12:30:00.000Z",
    notes: null,
    createdAt: "2026-07-12T12:30:00.000Z",
    updatedAt: "2026-07-12T12:30:00.000Z",
    items: [
      {
        id: "meal_item_1",
        foodId: "usda:173944",
        displayName: "Bananas, raw",
        consumedGrams: 100,
        servingQuantity: 100,
        servingUnit: "grams",
        calories: 89,
        proteinGrams: 1.1,
        carbohydrateGrams: 22.8,
        fatGrams: 0.3,
        fiberGrams: 2.6,
        sugarGrams: 12.2,
        sodiumMilligrams: 1,
        sourceProvider: "usda",
        sourceExternalId: "173944",
        sourceVersion: "Foundation",
        sourceReference: "https://fdc.nal.usda.gov/fdc-app.html#/food-details/173944/nutrients",
        nutrientSnapshotJson: {
          nutrientsPer100g: {
            caloriesKcal: 89,
            proteinGrams: 1.1,
            carbohydrateGrams: 22.8,
            fatGrams: 0.3,
            fiberGrams: 2.6,
            sugarGrams: 12.2,
            sodiumMilligrams: 1,
          },
        },
        confidence: {
          identity: "verified",
          portion: "verified",
          nutritionRecord: "high",
          explanation: "Based on the confirmed portion and saved USDA source.",
        },
        userConfirmed: true,
        preparationMethod: "raw",
        addedOilGrams: 0,
        notes: null,
        createdAt: "2026-07-12T12:30:00.000Z",
        updatedAt: "2026-07-12T12:30:00.000Z",
      },
    ],
  };
}

function replacementFood(): FoodSearchResult {
  return {
    id: "usda:plantain",
    displayName: "Plantains, raw",
    provider: "usda",
    externalId: "plantain",
    dataType: "Foundation",
    brandOwner: null,
    servingSize: null,
    servingSizeUnit: null,
    householdServingText: null,
    nutrientsPer100g: {
      caloriesKcal: 122,
      proteinGrams: 1.3,
      carbohydrateGrams: 31.9,
      fatGrams: 0.4,
      fiberGrams: 2.3,
      sugarGrams: 15,
      sodiumMilligrams: 4,
    },
    qualityFlags: [],
    recordConfidence: "high",
    sourceReference: "USDA fixture",
  };
}

function addedFood(): FoodSearchResult {
  return {
    id: "usda:oatmeal",
    displayName: "Oatmeal, cooked",
    provider: "usda",
    externalId: "oatmeal",
    dataType: "Foundation",
    brandOwner: null,
    servingSize: null,
    servingSizeUnit: null,
    householdServingText: null,
    nutrientsPer100g: {
      caloriesKcal: 68,
      proteinGrams: 2.4,
      carbohydrateGrams: 12,
      fatGrams: 1.4,
      fiberGrams: 1.7,
      sugarGrams: 0.3,
      sodiumMilligrams: 49,
    },
    recordConfidence: "high",
    sourceReference: "https://fdc.nal.usda.gov/",
  };
}

async function renderWithQueryClient(element: ReactElement, themePreference: ThemePreference = "light") {
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
