import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import {
  AccessibilitySettingsScreen,
  appearanceLabel,
  formatTextScale,
} from "../AccessibilitySettingsScreen";

const mockBack = jest.fn();
const mockListeners = new Map<string, (enabled: boolean) => void>();
const mockRemove = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));

describe("AccessibilitySettingsScreen", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    mockBack.mockReset();
    mockRemove.mockReset();
    mockListeners.clear();
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isReduceTransparencyEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(
      (event, listener) => {
        mockListeners.set(event, listener as unknown as (enabled: boolean) => void);
        return { remove: mockRemove } as never;
      }
    );
  });

  it("reads device accessibility settings and responds to live changes", async () => {
    const view = await renderScreen();

    await waitFor(() => {
      expect(view.getByLabelText(/Text size .* Reduce motion off. Reduce transparency off. Screen reader off/)).toBeTruthy();
    });
    expect(view.getByText("Follow system")).toBeTruthy();

    await act(async () => {
      mockListeners.get("reduceMotionChanged")?.(true);
      mockListeners.get("screenReaderChanged")?.(true);
    });

    await waitFor(() => {
      expect(view.getByLabelText(/Reduce motion on. Reduce transparency off. Screen reader on/)).toBeTruthy();
    });
  });

  it("keeps a recoverable notice when device settings cannot be refreshed", async () => {
    const view = await renderScreen();

    await view.findByText("Refresh device settings");
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockRejectedValueOnce(
      new Error("Accessibility API unavailable")
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText("Refresh device settings"));
    });

    await waitFor(() => {
      expect(view.getByText("Accessibility settings need attention")).toBeTruthy();
      expect(view.getByText(/could not be refreshed/)).toBeTruthy();
    });
  });

  it("formats user-facing accessibility labels without medical claims", () => {
    expect(formatTextScale(1.25)).toBe("125%");
    expect(appearanceLabel("system")).toBe("Follow system");
    expect(appearanceLabel("dark")).toBe("Dark");
  });
});

async function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference="system">
        <AccessibilitySettingsScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
