import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { FoodSearchResult } from "@living-nutrition/shared-types";
import { MealBuilderScreen } from "../MealBuilderScreen";

const mockSearchFoods = jest.fn();
const mockCreateMeal = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockQueueConfirmedMeal = jest.fn();
const mockReplace = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactElement }) => children,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
    getRecipe: jest.fn(),
    createRecipe: jest.fn(),
    updateRecipe: jest.fn(),
  },
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  queueConfirmedMeal: (...args: unknown[]) => mockQueueConfirmedMeal(...args),
}));

jest.mock("../../../shared/domain/offlineMealSync", () => ({
  canQueueConfirmedMeal: (error: unknown) => error instanceof Error && error.message === "network unavailable",
}));

describe("MealBuilderScreen", () => {
  beforeEach(() => {
    mockSearchFoods.mockReset();
    mockCreateMeal.mockReset();
    mockGetStoredUserId.mockReset();
    mockQueueConfirmedMeal.mockReset();
    mockReplace.mockReset();
    mockNotificationAsync.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    cleanup();
  });

  it("adds a provider record, applies the entered grams, and saves a meal snapshot", async () => {
    mockSearchFoods.mockResolvedValue({ items: [bananaFood()] });
    mockCreateMeal.mockResolvedValue({ id: "meal_1" });

    const view = await renderWithQueryClient(<MealBuilderScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Search foods to add to the meal"), "banana");
    });

    await waitFor(() => {
      expect(view.getByLabelText("Add Bananas, raw to meal")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Add Bananas, raw to meal"));
    });

    const gramsInput = view.getByLabelText("Weight in grams for Bananas, raw");
    expect(view.getByText("Item 1 of 1. Drag the handle to reorder live, or use the move controls below.")).toBeTruthy();
    expect(view.getByLabelText("Move Bananas, raw up").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(view.getByLabelText("Move Bananas, raw down").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      fireEvent.changeText(gramsInput, "150");
    });

    expect(view.getAllByText("134 kcal")).toHaveLength(2);
    expect(
      view.getByLabelText(
        "Meal total: 134 calories, 1.7 grams protein, 34.2 grams carbohydrates, and 0.5 grams fat. Updates as you adjust portions."
      )
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Save meal"));
    });

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              foodId: "usda:173944",
              consumedGrams: 150,
              sourceProvider: "usda",
            }),
          ],
        }),
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^builder-/) })
      );
    });
    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByText("View Today"));
    });
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("suggests a category from meal time without overriding an explicit choice", async () => {
    const view = await renderWithQueryClient(<MealBuilderScreen />);
    const timeInput = view.getByLabelText("Meal time in 24-hour format");

    expect(view.getByLabelText("Meal category").props.accessibilityRole).toBe("radiogroup");
    expect(view.getByLabelText("Set meal category to Dinner").props.accessibilityRole).toBe("radio");

    await act(async () => {
      fireEvent.changeText(timeInput, "12:30");
    });
    await view.findByText("Suggested lunch from 12:30. Choose a category above to override.");

    await act(async () => {
      fireEvent.press(view.getByLabelText("Set meal category to Dinner"));
    });
    await view.findByText("Category set manually. Changing the time will not overwrite it.");
    await act(async () => {
      fireEvent.changeText(timeInput, "08:00");
    });

    await view.findByText("Category set manually. Changing the time will not overwrite it.");
    expect(view.getByLabelText("Set meal category to Dinner").props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(view.getByLabelText("Set meal time to Lunch").props.accessibilityHint).toContain("Sets the meal time");
  });

  it("queues a confirmed source-backed meal after an ambiguous save failure", async () => {
    mockSearchFoods.mockResolvedValue({ items: [bananaFood()] });
    mockCreateMeal.mockRejectedValue(new Error("network unavailable"));
    mockGetStoredUserId.mockResolvedValue("user_1");
    mockQueueConfirmedMeal.mockResolvedValue(undefined);

    const view = await renderWithQueryClient(<MealBuilderScreen />);
    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Search foods to add to the meal"), "banana");
    });
    await waitFor(() => {
      expect(view.getByLabelText("Add Bananas, raw to meal")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Add Bananas, raw to meal"));
    });
    await waitFor(() => {
      expect(view.getByLabelText("Weight in grams for Bananas, raw")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Save meal"));
    });

    await waitFor(() => {
      expect(mockQueueConfirmedMeal).toHaveBeenCalledWith(
        "user_1",
        expect.objectContaining({
          items: [expect.objectContaining({ foodId: "usda:173944", sourceProvider: "usda" })],
        }),
        expect.stringMatching(/^builder-/)
      );
    });
    expect(await view.findByText("Confirmed meal queued")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

function bananaFood(): FoodSearchResult {
  return {
    id: "usda:173944",
    displayName: "Bananas, raw",
    provider: "usda",
    externalId: "173944",
    dataType: "Foundation",
    brandOwner: null,
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
    recordConfidence: "high",
    sourceReference: "USDA fixture",
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
