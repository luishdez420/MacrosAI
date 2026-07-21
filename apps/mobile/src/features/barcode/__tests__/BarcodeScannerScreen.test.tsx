import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";

import { themePalettes, type ThemePreference } from "@living-nutrition/design-tokens";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { BarcodeScannerScreen } from "../BarcodeScannerScreen";

const mockGetFoodByBarcode = jest.fn();
const mockCreateMeal = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNotificationAsync = jest.fn((_type: unknown) => Promise.resolve());

jest.mock("expo-camera", () => ({
  CameraView: ({
    accessibilityHint,
    accessibilityLabel,
    onBarcodeScanned,
  }: {
    accessibilityHint?: string;
    accessibilityLabel?: string;
    onBarcodeScanned?: (result: { data: string }) => void;
  }) => {
    const React = require("react");
    const { Pressable, Text } = require("react-native");

    return React.createElement(
      Pressable,
      {
        accessibilityHint,
        accessibilityLabel,
        accessibilityRole: "button",
        testID: "mock-camera",
        onPress: () => onBarcodeScanned?.({ data: "0 12345-67890 5" }),
      },
      React.createElement(Text, null, "Mock camera")
    );
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: {
    Success: "success",
  },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: (type: unknown) => mockNotificationAsync(type),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getFoodByBarcode: (...args: unknown[]) => mockGetFoodByBarcode(...args),
    createMeal: (...args: unknown[]) => mockCreateMeal(...args),
  },
}));

describe("BarcodeScannerScreen", () => {
  beforeEach(() => {
    mockGetFoodByBarcode.mockReset();
    mockCreateMeal.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockNotificationAsync.mockClear();
  });

  it("shows inline recovery actions after a barcode no-match instead of looping alerts", async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce({ items: [] });
    const view = await renderWithQueryClient(<BarcodeScannerScreen />);

    expect(view.getByLabelText("Barcode camera preview").props.accessibilityHint).toBe(
      "Point the camera at a package barcode."
    );
    expect(view.getByLabelText("Barcode number")).toBeTruthy();
    expect(view.getByLabelText("Find barcode")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId("mock-camera"));
    });

    await waitFor(() => {
      expect(view.getByText("No reliable match found")).toBeTruthy();
    });

    expect(mockGetFoodByBarcode).toHaveBeenCalledWith("012345678905");
    expect(view.getByText("Scanner paused. Choose an action below.")).toBeTruthy();
    expect(view.getByText("Scan again")).toBeTruthy();
    expect(view.getByText("Type barcode")).toBeTruthy();
    expect(view.getByText("Photograph label")).toBeTruthy();
    expect(view.getByText("Search manually")).toBeTruthy();
    expect(view.getByText("Create custom")).toBeTruthy();
    expect(view.getByLabelText("Barcode camera preview").props.accessibilityHint).toBe(
      "Scanner is paused. Choose Scan again or type the barcode below."
    );
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });

  it("confirms a matched packaged-food save before navigating and uses success feedback only after match/save", async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce({ items: [packagedFood()] });
    mockCreateMeal.mockResolvedValueOnce({ id: "meal_1" });
    const view = await renderWithQueryClient(<BarcodeScannerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId("mock-camera"));
    });
    await waitFor(() => {
      expect(view.getByText("Matched packaged food")).toBeTruthy();
    });
    expect(mockNotificationAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(view.getByText("Log packaged food"));
    });
    expect(await view.findByText("Packaged food logged.")).toBeTruthy();
    expect(mockNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByText("View Today"));
    });
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("translates packaged-food quality warnings into actionable user-facing copy", async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce({
      items: [packagedFood({ qualityFlags: ["unverified_serving_basis"] })],
    });
    const view = await renderWithQueryClient(<BarcodeScannerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId("mock-camera"));
    });

    expect(await view.findByText(/Serving has no verified gram weight/)).toBeTruthy();
    expect(view.queryByText(/unverified_serving_basis/)).toBeNull();
  });

  it("uses semantic dark-theme colors for actionable copy and barcode input placeholders", async () => {
    const view = await renderWithQueryClient(<BarcodeScannerScreen />, "dark");

    expect(StyleSheet.flatten(view.getByText("Close").props.style).color).toBe(
      themePalettes.dark.actionText
    );
    expect(view.getByLabelText("Barcode number").props.placeholderTextColor).toBe(
      themePalettes.dark.muted
    );
  });
});

function packagedFood(overrides: Record<string, unknown> = {}) {
  return {
    id: "off:123",
    displayName: "Example protein bar",
    provider: "open_food_facts",
    externalId: "123",
    dataType: "branded",
    brandOwner: "Example Foods",
    servingSize: 50,
    servingSizeUnit: "g",
    householdServingText: "1 bar",
    nutrientsPer100g: {
      caloriesKcal: 400,
      proteinGrams: 20,
      carbohydrateGrams: 48,
      fatGrams: 16,
      fiberGrams: 8,
      sugarGrams: 6,
      sodiumMilligrams: 220,
    },
    recordConfidence: "high",
    sourceReference: "Open Food Facts fixture",
    ...overrides,
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
    <ThemeProvider initialPreference={themePreference}>
      <QueryClientProvider client={queryClient}>
        {element}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
