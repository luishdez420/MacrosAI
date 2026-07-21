import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiClientError } from "@living-nutrition/api-client";

import { CustomFoodScreen } from "../CustomFoodScreen";
import { useLabelDraftStore } from "../../../stores/labelDraftStore";

const mockGetFood = jest.fn();
const mockCreateCustomFood = jest.fn();
const mockUpdateCustomFood = jest.fn();
const mockDeleteCustomFood = jest.fn();
const mockCreateMeal = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockQueueConfirmedMeal = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());
const queryClients: QueryClient[] = [];
let mockSearchParams: {
  foodId?: string;
  barcode: string;
  labelCaptured?: string;
  labelAnalyzed?: string;
} = {
  barcode: "0 12345-67890 5",
  labelCaptured: "1",
  labelAnalyzed: undefined as string | undefined,
};

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getFood: (...args: unknown[]) => mockGetFood(...args),
    createCustomFood: (...args: unknown[]) => mockCreateCustomFood(...args),
    updateCustomFood: (...args: unknown[]) => mockUpdateCustomFood(...args),
    deleteCustomFood: (...args: unknown[]) => mockDeleteCustomFood(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  queueConfirmedMeal: (...args: unknown[]) => mockQueueConfirmedMeal(...args),
}));

describe("CustomFoodScreen", () => {
  beforeEach(() => {
    mockGetFood.mockReset();
    mockCreateCustomFood.mockReset();
    mockUpdateCustomFood.mockReset();
    mockDeleteCustomFood.mockReset();
    mockCreateMeal.mockReset();
    mockReplace.mockReset();
    mockPush.mockReset();
    mockGetStoredUserId.mockReset();
    mockQueueConfirmedMeal.mockReset();
    mockNotificationAsync.mockClear();
    mockSearchParams = {
      barcode: "0 12345-67890 5",
      labelCaptured: "1",
      labelAnalyzed: undefined,
    };
    mockGetStoredUserId.mockResolvedValue(undefined);
    mockQueueConfirmedMeal.mockResolvedValue(undefined);
    useLabelDraftStore.getState().clearDraft();
  });

  afterEach(() => {
    cleanup();
    queryClients.splice(0).forEach((queryClient) => queryClient.clear());
  });

  it("requires explicit manual label review before saving a label-captured custom food", async () => {
    mockCreateCustomFood.mockImplementation(() => new Promise(() => undefined));

    const view = await renderWithQueryClient(<CustomFoodScreen />);

    await waitFor(() => {
      expect(view.getByText("Label photo captured")).toBeTruthy();
    });
    expect(view.getByLabelText("Close custom food editor")).toBeTruthy();
    expect(view.getByLabelText("Confirm nutrition label values were manually reviewed").props.accessibilityHint).toContain(
      "Required before saving"
    );

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
    expect(mockCreateCustomFood.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^custom-food-/) })
    );
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

  it("queues a custom-food meal only after its food record was saved and the meal save is ambiguous", async () => {
    mockSearchParams = { barcode: "", labelCaptured: undefined, labelAnalyzed: undefined };
    mockCreateCustomFood.mockResolvedValue(customFoodResult());
    mockCreateMeal.mockRejectedValue(new ApiClientError("Offline", { status: 0 }));
    mockGetStoredUserId.mockResolvedValue("user-custom");
    const view = await renderWithQueryClient(<CustomFoodScreen />);

    fireEvent.changeText(view.getByLabelText("Food name"), "Weekend oats");
    await waitFor(() => expect(view.getByDisplayValue("Weekend oats")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Calories"), "350");
    await waitFor(() => expect(view.getByDisplayValue("350")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Protein (g)"), "12");
    await waitFor(() => expect(view.getByDisplayValue("12")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Carbs (g)"), "58");
    await waitFor(() => expect(view.getByDisplayValue("58")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Fat (g)"), "7");
    await waitFor(() => expect(view.getByDisplayValue("7")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText("Create and log food"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockCreateCustomFood).toHaveBeenCalledTimes(1);
      expect(mockQueueConfirmedMeal).toHaveBeenCalledWith(
        "user-custom",
        expect.objectContaining({ name: "Weekend oats" }),
        expect.stringMatching(/^custom[_-]/)
      );
      expect(view.getByText("Confirmed custom food queued")).toBeTruthy();
      expect(view.getByText("Go to Today")).toBeTruthy();
    });
    expect(mockQueueConfirmedMeal.mock.calls[0]?.[1]).not.toHaveProperty("imageBase64");
  });

  it("requires confirmation before removing an editable custom food", async () => {
    mockSearchParams = { barcode: "", foodId: "user:custom-1", labelCaptured: undefined, labelAnalyzed: undefined };
    mockGetFood.mockResolvedValue(customFoodResult());
    mockDeleteCustomFood.mockResolvedValue(undefined);

    const view = await renderWithQueryClient(<CustomFoodScreen />);

    await waitFor(() => {
      expect(view.getByLabelText("Remove custom food")).toBeTruthy();
    });

    fireEvent.press(view.getByLabelText("Remove custom food"));
    await waitFor(() => {
      expect(view.getByText(/removes the reusable custom food and its saved-food links/)).toBeTruthy();
    });
    expect(mockDeleteCustomFood).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Remove food"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(mockDeleteCustomFood).toHaveBeenCalledWith("user:custom-1");
      expect(mockReplace).toHaveBeenCalledWith("/saved-foods");
    });
  });

  it("confirms a persisted custom-food meal before the user continues to Today", async () => {
    mockSearchParams = { barcode: "", labelCaptured: undefined, labelAnalyzed: undefined };
    mockCreateCustomFood.mockResolvedValue(customFoodResult());
    mockCreateMeal.mockResolvedValue({ id: "meal_custom_1" });
    const view = await renderWithQueryClient(<CustomFoodScreen />);

    fireEvent.changeText(view.getByLabelText("Food name"), "Weekend oats");
    await waitFor(() => expect(view.getByDisplayValue("Weekend oats")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Calories"), "350");
    await waitFor(() => expect(view.getByDisplayValue("350")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Protein (g)"), "12");
    await waitFor(() => expect(view.getByDisplayValue("12")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Carbs (g)"), "58");
    await waitFor(() => expect(view.getByDisplayValue("58")).toBeTruthy());
    fireEvent.changeText(view.getByLabelText("Fat (g)"), "7");
    await waitFor(() => expect(view.getByDisplayValue("7")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText("Create and log food"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(await view.findByText("Meal saved.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledWith("success");
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(view.getByText("View Today"));

    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});

function customFoodResult() {
  return {
    id: "user:custom-oats",
    displayName: "Weekend oats",
    provider: "user" as const,
    externalId: "custom-oats",
    dataType: "custom",
    brandOwner: null,
    servingSize: 100,
    servingSizeUnit: "g",
    householdServingText: null,
    nutrientsPer100g: {
      caloriesKcal: 350,
      proteinGrams: 12,
      carbohydrateGrams: 58,
      fatGrams: 7,
    },
    qualityFlags: [],
    recordConfidence: "verified" as const,
    sourceReference: "Living Nutrition custom food",
  };
}

async function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  queryClients.push(queryClient);

  // Editing uses a food-detail query. Seed its deterministic fixture so the
  // form's hydration effect is flushed by the render transaction below rather
  // than by a query notification after the test has started asserting.
  if (mockSearchParams.foodId) {
    queryClient.setQueryData(["food-detail", mockSearchParams.foodId, "custom-edit"], customFoodResult());
  }

  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
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
    // Let an immediately resolved provider-detail query flush while this
    // render remains inside React's test transaction.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  if (!view) {
    throw new Error("Custom food screen did not render.");
  }
  return view;
}
