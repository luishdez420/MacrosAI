import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NaturalEntryScreen } from "../NaturalEntryScreen";

const mockReplace = jest.fn();
const mockSearchFoods = jest.fn();
const mockCreateMeal = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
}));

describe("NaturalEntryScreen", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockSearchFoods.mockReset();
    mockCreateMeal.mockReset();
    mockNotificationAsync.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    cleanup();
  });

  it("explains provider-backed count handling without inferring volume", async () => {
    const view = await renderWithQueryClient(<NaturalEntryScreen />);

    expect(view.getByText("Describe it, then confirm the records.")).toBeTruthy();
    expect(view.getByLabelText("Meal description with weights or source-serving counts")).toBeTruthy();
    expect(view.getByText("Find food records")).toBeTruthy();
    expect(view.getByText(/Counts only work when the selected source has a verified gram serving/)).toBeTruthy();
  });

  it("logs a count only after a selected source supplies a verified gram serving", async () => {
    mockSearchFoods.mockResolvedValue({ items: [scrambledEggs()] });
    mockCreateMeal.mockResolvedValue({ id: "meal_1" });
    const view = await renderWithQueryClient(<NaturalEntryScreen />);

    fireEvent.changeText(view.getByLabelText("Meal description with weights or source-serving counts"), "two eggs");
    await waitFor(() => {
      expect(view.getByLabelText("Meal description with weights or source-serving counts").props.value).toBe("two eggs");
    });
    await act(async () => {
      fireEvent.press(view.getByText("Find food records"));
    });

    await view.findByLabelText("Use Scrambled eggs for eggs");
    expect(view.getByLabelText("Food records for eggs").props.accessibilityRole).toBe("radiogroup");
    expect(view.getByLabelText("Use Scrambled eggs for eggs").props.accessibilityRole).toBe("radio");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Use Scrambled eggs for eggs"));
    });
    await view.findByText("Selected");
    expect(view.getByText("100g from 2 source servings")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Log confirmed meal"));
    });

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [
            expect.objectContaining({
              consumedGrams: 100,
              servingQuantity: 2,
              servingUnit: "serving",
            }),
          ],
        }),
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^natural-/) })
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
});

function scrambledEggs() {
  return {
    id: "usda:eggs",
    displayName: "Scrambled eggs",
    provider: "usda" as const,
    externalId: "eggs",
    dataType: "Foundation",
    brandOwner: null,
    publicationDate: null,
    servingSize: 50,
    servingSizeUnit: "g",
    householdServingText: "1 egg",
    nutrientsPer100g: {
      caloriesKcal: 150,
      proteinGrams: 10,
      carbohydrateGrams: 2,
      fatGrams: 11,
      fiberGrams: 0,
      sugarGrams: 1,
      sodiumMilligrams: 140,
    },
    originalNutrientIds: {},
    qualityFlags: [],
    recordConfidence: "high" as const,
    sourceReference: "USDA fixture",
    retrievedAt: "2026-07-13T00:00:00.000Z",
  };
}

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
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </SafeAreaProvider>
  );
}
