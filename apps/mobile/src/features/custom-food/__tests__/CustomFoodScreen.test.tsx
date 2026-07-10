import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CustomFoodScreen } from "../CustomFoodScreen";
import { useLabelDraftStore } from "../../../stores/labelDraftStore";

const mockGetFood = jest.fn();
const mockCreateCustomFood = jest.fn();
const mockUpdateCustomFood = jest.fn();
const mockCreateMeal = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = {
  barcode: "0 12345-67890 5",
  labelCaptured: "1",
  labelAnalyzed: undefined as string | undefined,
};

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getFood: (...args: unknown[]) => mockGetFood(...args),
    createCustomFood: (...args: unknown[]) => mockCreateCustomFood(...args),
    updateCustomFood: (...args: unknown[]) => mockUpdateCustomFood(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
}));

describe("CustomFoodScreen", () => {
  beforeEach(() => {
    mockGetFood.mockReset();
    mockCreateCustomFood.mockReset();
    mockUpdateCustomFood.mockReset();
    mockCreateMeal.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
    mockSearchParams = {
      barcode: "0 12345-67890 5",
      labelCaptured: "1",
      labelAnalyzed: undefined,
    };
    useLabelDraftStore.getState().clearDraft();
  });

  it("requires explicit manual label review before saving a label-captured custom food", async () => {
    mockCreateCustomFood.mockImplementation(() => new Promise(() => undefined));

    const view = await renderWithQueryClient(<CustomFoodScreen />);

    await waitFor(() => {
      expect(view.getByText("Label photo captured")).toBeTruthy();
    });

    fireEvent.changeText(view.getByLabelText("Food name"), "Test label bar");
    await waitFor(() => expect(view.getByDisplayValue("Test label bar")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Brand or source (optional)"), "Kitchen shelf");
    await waitFor(() => expect(view.getByDisplayValue("Kitchen shelf")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Calories"), "250");
    await waitFor(() => expect(view.getAllByDisplayValue("250").length).toBeGreaterThanOrEqual(1));
    fireEvent.changeText(view.getByLabelText("Protein (g)"), "10");
    await waitFor(() => expect(view.getAllByDisplayValue("10").length).toBeGreaterThanOrEqual(1));
    fireEvent.changeText(view.getByLabelText("Carbs (g)"), "30");
    await waitFor(() => expect(view.getAllByDisplayValue("30").length).toBeGreaterThanOrEqual(1));
    fireEvent.changeText(view.getByLabelText("Fat (g)"), "8");
    await waitFor(() => expect(view.getAllByDisplayValue("8").length).toBeGreaterThanOrEqual(1));

    fireEvent.press(view.getByText("Create without logging"));

    await waitFor(() => {
      expect(view.getByText("Check custom food details")).toBeTruthy();
    });
    expect(view.getByText(/Confirm you reviewed the nutrition label photo/)).toBeTruthy();
    expect(mockCreateCustomFood).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText("Confirm nutrition label values were manually reviewed"));
    await waitFor(() => {
      expect(
        view.getByLabelText("Confirm nutrition label values were manually reviewed").props.accessibilityState
      ).toMatchObject({ checked: true });
    });
    fireEvent.press(view.getByText("Create without logging"));

    await waitFor(() => {
      expect(mockCreateCustomFood).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateCustomFood.mock.calls[0]?.[0]).toMatchObject({
      displayName: "Test label bar",
      barcode: "012345678905",
      brandOwner: "Kitchen shelf",
      notes: expect.stringContaining("Nutrition label photo was used as a manual reference"),
      nutrientsPer100g: {
        caloriesKcal: 250,
        proteinGrams: 10,
        carbohydrateGrams: 30,
        fatGrams: 8,
      },
    });
  });

  it("prefills normalized label values but still requires explicit comparison", async () => {
    mockSearchParams = {
      barcode: "0 12345-67890 5",
      labelCaptured: "1",
      labelAnalyzed: "1",
    };
    useLabelDraftStore.getState().setDraft({
      photoUri: "file:///nutrition-label.jpg",
      analysis: {
        displayName: "Oat bar",
        brandOwner: "Test Foods",
        barcode: "012345678905",
        servingSizeText: "1 bar (40 g)",
        servingSizeGrams: 40,
        nutritionBasis: "per_serving",
        labelNutrients: {
          caloriesKcal: 160,
          proteinGrams: 4,
          carbohydrateGrams: 24,
          fatGrams: 6,
          fiberGrams: 3,
          sugarGrams: 8,
          sodiumMilligrams: 120,
        },
        nutrientsPer100g: {
          caloriesKcal: 400,
          proteinGrams: 10,
          carbohydrateGrams: 60,
          fatGrams: 15,
          fiberGrams: 7.5,
          sugarGrams: 20,
          sodiumMilligrams: 300,
        },
        confidence: "high",
        qualityFlags: [],
        warnings: ["All extracted values require comparison with the original label before saving."],
        requiresConfirmation: true,
      },
    });
    mockCreateCustomFood.mockImplementation(() => new Promise(() => undefined));

    const view = await renderWithQueryClient(<CustomFoodScreen />);

    await waitFor(() => {
      expect(view.getByText("Label values extracted")).toBeTruthy();
      expect(view.getByDisplayValue("Oat bar")).toBeTruthy();
      expect(view.getByDisplayValue("Test Foods")).toBeTruthy();
      expect(view.getAllByDisplayValue("40").length).toBeGreaterThanOrEqual(1);
      expect(view.getAllByDisplayValue("400").length).toBeGreaterThanOrEqual(1);
      expect(view.getByText(/160 kcal · 4 g protein · 24 g carbs/)).toBeTruthy();
      expect(view.getByLabelText("Captured nutrition facts label for comparison")).toBeTruthy();
    });

    fireEvent.press(view.getByText("Create without logging"));
    await waitFor(() => {
      expect(view.getByText(/Confirm you reviewed the nutrition label photo/)).toBeTruthy();
    });
    expect(mockCreateCustomFood).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText("Confirm nutrition label values were manually reviewed"));
    await waitFor(() => {
      expect(
        view.getByLabelText("Confirm nutrition label values were manually reviewed").props.accessibilityState
      ).toMatchObject({ checked: true });
    });
    fireEvent.press(view.getByText("Create without logging"));

    await waitFor(() => expect(mockCreateCustomFood).toHaveBeenCalledTimes(1));
    expect(mockCreateCustomFood.mock.calls[0]?.[0]).toMatchObject({
      displayName: "Oat bar",
      servingSize: 40,
      notes: expect.stringContaining("machine-extracted"),
      nutrientsPer100g: {
        caloriesKcal: 400,
        proteinGrams: 10,
        carbohydrateGrams: 60,
        fatGrams: 15,
      },
    });
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
