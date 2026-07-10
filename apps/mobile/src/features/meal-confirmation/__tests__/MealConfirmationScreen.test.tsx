import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import type { FoodSearchResult, MealAnalysisResult } from "@living-nutrition/shared-types";
import { useAnalysisDraftStore } from "../../../stores/analysisDraftStore";
import { MealConfirmationScreen } from "../MealConfirmationScreen";

const mockHealthCheck = jest.fn();
const mockAnalyzeMealPhoto = jest.fn();
const mockCreateMeal = jest.fn();
const mockCreateFoodCorrectionReport = jest.fn();
const mockSearchFoods = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
    analyzeMealPhoto: (...args: unknown[]) => mockAnalyzeMealPhoto(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
    createFoodCorrectionReport: (...args: unknown[]) => mockCreateFoodCorrectionReport(...args),
    searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
  },
}));

describe("MealConfirmationScreen", () => {
  beforeEach(() => {
    mockHealthCheck.mockReset();
    mockAnalyzeMealPhoto.mockReset();
    mockCreateMeal.mockReset();
    mockCreateFoodCorrectionReport.mockReset();
    mockSearchFoods.mockReset();
    mockReplace.mockReset();
    mockHealthCheck.mockResolvedValue({ status: "ok" });
    mockAnalyzeMealPhoto.mockResolvedValue(mealAnalysis());
    mockCreateMeal.mockImplementation(() => new Promise(() => undefined));
    mockSearchFoods.mockImplementation((query: string) => ({
      items: query.toLowerCase().includes("ranch") ? [ranchDressing()] : [],
    }));
    useAnalysisDraftStore.setState({
      draftPhoto: {
        uri: "file://camera-meal.jpg",
        base64: "base64-meal",
        source: "camera",
      },
    });
  });

  afterEach(() => {
    cleanup();
    useAnalysisDraftStore.setState({ draftPhoto: undefined });
  });

  it("blocks camera meal logging until food identity, preparation, and add-on portions are reviewed", async () => {
    const view = await renderWithQueryClient(<MealConfirmationScreen />);

    await waitFor(() => {
      expect(view.getByText("Detected foods")).toBeTruthy();
    });

    fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(view.getByText(/Review Grilled chicken breast before logging/)).toBeTruthy();
    });
    expect(mockCreateMeal).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByText("Confirm this food"));
    });
    await waitFor(() => {
      expect(view.getByText("Food confirmed")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Grilled"));
    });
    await waitFor(() => {
      expect(view.getByText("Reviewed")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("Search ranch, cheese, sugar, avocado..."), "ranch");
    });
    await waitFor(() => {
      expect(view.getByText("Ranch dressing")).toBeTruthy();
    });
    fireEvent.press(view.getByText("Add"));
    await waitFor(() => {
      expect(view.getByText("View add-on source")).toBeTruthy();
    });
    expect(view.getByLabelText("View nutrition source for Ranch dressing add-on")).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Grams for Ranch dressing add-on"), "");
    });
    await waitFor(() => {
      expect(view.getByLabelText("Grams for Ranch dressing add-on").props.value).toBe("");
    });
    fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(view.getByText(/Review add-on portions for Grilled chicken breast before logging/)).toBeTruthy();
    });
    expect(mockCreateMeal).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(view.getByLabelText("Grams for Ranch dressing add-on"), "20");
    });
    fireEvent.press(view.getByText("Log meal"));

    await waitFor(() => {
      expect(mockCreateMeal).toHaveBeenCalledTimes(1);
    });

    const payload = mockCreateMeal.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      name: "Chicken plate",
      items: [
        {
          foodId: "usda:12345",
          displayName: "Grilled chicken breast",
          consumedGrams: 145,
          servingUnit: "grams",
          sourceProvider: "usda",
          sourceExternalId: "12345",
          userConfirmed: true,
          preparationMethod: "grilled",
          confidence: {
            portion: "verified",
            explanation: "Food source matched from the scan; calories are based on the portion entered.",
          },
          nutrientSnapshotJson: {
            detectedName: "chicken",
            identityConfirmed: true,
            preparationMethod: "grilled",
            confirmedGrams: 145,
            addOns: [
              {
                displayName: "Ranch dressing",
                grams: 20,
                provider: "usda",
                externalId: "67890",
              },
            ],
          },
        },
        {
          foodId: "usda:67890",
          displayName: "Ranch dressing add-on",
          consumedGrams: 20,
          servingUnit: "grams",
          sourceProvider: "usda",
          sourceExternalId: "67890",
          userConfirmed: true,
          preparationMethod: "add_on",
          confidence: {
            identity: "verified",
            portion: "verified",
            explanation: "Provider-backed add-on selected during camera confirmation.",
          },
        },
      ],
    });
  });
});

function ranchDressing(): FoodSearchResult {
  return {
    id: "usda:67890",
    displayName: "Ranch dressing",
    provider: "usda",
    externalId: "67890",
    dataType: "FNDDS",
    brandOwner: null,
    publicationDate: "2025-01-01",
    servingSize: 30,
    servingSizeUnit: "g",
    householdServingText: "2 tbsp",
    nutrientsPer100g: {
      caloriesKcal: 430,
      proteinGrams: 1,
      carbohydrateGrams: 6,
      fatGrams: 45,
      fiberGrams: 0,
      sugarGrams: 4,
      sodiumMilligrams: 900,
    },
    originalNutrientIds: {
      caloriesKcal: "208",
    },
    qualityFlags: ["serving_per_100g_conflict"],
    recordConfidence: "medium",
    sourceReference: "USDA FoodData Central ranch fixture",
    retrievedAt: "2026-07-09T12:00:00.000Z",
  };
}

function mealAnalysis(): MealAnalysisResult {
  return {
    id: "analysis_1",
    status: "ready",
    mealName: "Chicken plate",
    summary: "Estimated grilled chicken breast.",
    notes: "Single photo estimate requires review.",
    totalNutrients: {
      caloriesKcal: 239,
      proteinGrams: 45,
      carbohydrateGrams: 0,
      fatGrams: 5.2,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 107,
    },
    confidence: {
      identity: "medium",
      portion: "low",
      nutritionRecord: "high",
      explanation: "Visible food matched to a provider record; portion is estimated.",
    },
    createdAt: "2026-07-09T12:00:00.000Z",
    items: [
      {
        id: "item_1",
        detectedName: "chicken",
        candidateLabels: ["grilled chicken breast", "roasted chicken breast"],
        displayName: "Grilled chicken breast",
        provider: "usda",
        externalId: "12345",
        dataType: "FNDDS",
        sourceReference: "USDA FoodData Central fixture",
        servingGrams: 145,
        servingLabel: "estimated portion",
        nutrients: {
          caloriesKcal: 165,
          proteinGrams: 31,
          carbohydrateGrams: 0,
          fatGrams: 3.6,
          fiberGrams: 0,
          sugarGrams: 0,
          sodiumMilligrams: 74,
        },
        confidence: {
          identity: "medium",
          portion: "low",
          nutritionRecord: "high",
          explanation: "Matched from the scan, but portion and preparation need confirmation.",
        },
        needsReview: true,
        notes: "Oil quantity cannot be determined from the image.",
      },
    ],
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
    <QueryClientProvider client={queryClient}>
      {element}
    </QueryClientProvider>
  );
}
