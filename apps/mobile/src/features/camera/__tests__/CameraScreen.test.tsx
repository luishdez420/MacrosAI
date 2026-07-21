import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CameraScreen } from "../CameraScreen";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";

const mockTakePicture = jest.fn();
const mockImportPhoto = jest.fn();
const mockPush = jest.fn();
let mockPermissionGranted = true;

jest.mock("expo-camera", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    CameraView: React.forwardRef((_props: unknown, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
      return React.createElement(View, { testID: "meal-camera" });
    }),
    useCameraPermissions: () => [{ granted: mockPermissionGranted }, jest.fn()],
  };
});

jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: (...args: unknown[]) => mockImportPhoto(...args),
}));

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactElement }) => children,
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

describe("CameraScreen", () => {
  beforeEach(() => {
    mockTakePicture.mockReset();
    mockImportPhoto.mockReset();
    mockPush.mockReset();
    mockPermissionGranted = true;
  });

  it("keeps recovery options inline when a camera capture fails", async () => {
    mockTakePicture.mockRejectedValue(new Error("Camera unavailable"));
    const view = await renderCamera();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Capture meal photo"));
    });

    await waitFor(() => {
      expect(view.getByText("Meal photo needs attention")).toBeTruthy();
      expect(view.getByText(/could not capture that meal photo/)).toBeTruthy();
      expect(view.getByText("Try camera")).toBeTruthy();
      expect(view.getByText("Import photo")).toBeTruthy();
      expect(view.getByText("Enter food manually")).toBeTruthy();
    });
  });

  it("keeps recovery options inline when importing a meal photo fails", async () => {
    mockImportPhoto.mockRejectedValue(new Error("Library unavailable"));
    const view = await renderCamera();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Import a meal photo"));
    });

    await waitFor(() => {
      expect(view.getByText("Meal photo needs attention")).toBeTruthy();
      expect(view.getByText(/could not import that meal photo/)).toBeTruthy();
    });
    expect(view.getByLabelText("Import a meal photo").props.accessibilityHint).toContain(
      "You confirm every food and portion"
    );
  });

  it("offers an optional known plate reference without presenting it as an exact measurement", async () => {
    const view = await renderCamera();

    const option = view.getByLabelText("Use an approximately 28 cm plate as a visual reference");
    expect(option.props.accessibilityState.selected).toBe(false);
    expect(option.props.accessibilityHint).toContain("visual scale cue");

    await act(async () => {
      fireEvent.press(option);
    });

    expect(view.getByLabelText("Use an approximately 28 cm plate as a visual reference").props.accessibilityState.selected).toBe(true);
    expect(view.getByText(/It is a visual cue, not an exact weight measurement/)).toBeTruthy();
  });

  it("keeps a manual logging route available when camera permission is denied", async () => {
    mockPermissionGranted = false;
    const view = await renderCamera();

    expect(view.getByText("A clear photo makes review easier.")).toBeTruthy();
    expect(view.getByText(/You review every estimate before anything is saved/)).toBeTruthy();
    expect(view.getByText("Enable camera")).toBeTruthy();
    expect(view.getByText("Search for food instead")).toBeTruthy();
    expect(view.getByLabelText("Search for food manually instead of enabling the camera")).toBeTruthy();
    expect(view.queryByTestId("meal-camera")).toBeNull();
  });
});

async function renderCamera() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference="light">
        <CameraScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
