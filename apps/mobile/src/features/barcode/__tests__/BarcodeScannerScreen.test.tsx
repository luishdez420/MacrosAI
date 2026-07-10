import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import { BarcodeScannerScreen } from "../BarcodeScannerScreen";

const mockGetFoodByBarcode = jest.fn();
const mockCreateMeal = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-camera", () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: { data: string }) => void }) => {
    const React = require("react");
    const { Pressable, Text } = require("react-native");

    return React.createElement(
      Pressable,
      {
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
  NotificationFeedbackType: {
    Success: "success",
  },
  notificationAsync: jest.fn(() => Promise.resolve()),
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
  });

  it("shows inline recovery actions after a barcode no-match instead of looping alerts", async () => {
    mockGetFoodByBarcode.mockResolvedValueOnce({ items: [] });
    const view = await renderWithQueryClient(<BarcodeScannerScreen />);

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
    <QueryClientProvider client={queryClient}>
      {element}
    </QueryClientProvider>
  );
}
