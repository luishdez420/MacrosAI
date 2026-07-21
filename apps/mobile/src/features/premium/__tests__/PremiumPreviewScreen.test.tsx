import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { PremiumPreviewScreen } from "../PremiumPreviewScreen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
}));

describe("PremiumPreviewScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(cleanup);

  it("separates current free tools from planned membership directions", async () => {
    const view = await renderScreen();

    expect(view.getByText("Available now")).toBeTruthy();
    expect(view.getByText("In development")).toBeTruthy();
    expect(view.getByText("No membership is required today")).toBeTruthy();
    expect(view.getByText(/There is no payment flow, trial, hidden renewal/)).toBeTruthy();
  });

  it("keeps the free path and privacy controls actionable", async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByLabelText("Keep using free tools"));
    await fireEvent.press(view.getByLabelText("Review privacy controls"));

    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockPush).toHaveBeenCalledWith("/data-controls");
  });
});

async function renderScreen() {
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference="light">
        <PremiumPreviewScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
