import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "../../../shared/theme/ThemeProvider";
import { NotificationSettingsScreen } from "../NotificationSettingsScreen";

const mockBack = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockGetSettings = jest.fn();
const mockEnable = jest.fn();
const mockDisable = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("../../../services/api", () => ({
  getStoredUserId: () => mockGetStoredUserId(),
}));

jest.mock("../../../services/hydrationReminder", () => ({
  getHydrationReminderSettings: (...args: unknown[]) => mockGetSettings(...args),
  enableHydrationReminder: (...args: unknown[]) => mockEnable(...args),
  disableHydrationReminder: (...args: unknown[]) => mockDisable(...args),
  formatReminderTime: (time: string) => time,
  isValidReminderTime: (time: string) => /^\d{2}:\d{2}$/.test(time),
}));

describe("NotificationSettingsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoredUserId.mockResolvedValue("user-1");
    mockGetSettings.mockResolvedValue({ enabled: false, time: "15:00", notificationId: null });
    mockEnable.mockResolvedValue({
      status: "enabled",
      settings: { enabled: true, time: "19:00", notificationId: "reminder-1" },
    });
    mockDisable.mockResolvedValue({ enabled: false, time: "19:00", notificationId: null });
  });

  it("keeps reminders off until the user chooses to enable one", async () => {
    const view = await renderScreen();

    await waitFor(() => {
      expect(view.getByText("Not scheduled")).toBeTruthy();
    });
    expect(view.getByLabelText("Enable daily reminder")).toBeTruthy();

    fireEvent.changeText(view.getByLabelText("Daily reminder time"), "19:00");
    await waitFor(() => {
      expect(view.getByDisplayValue("19:00")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Enable daily reminder"));
    });

    await waitFor(() => {
      expect(mockEnable).toHaveBeenCalledWith("19:00", "user-1");
      expect(view.getByText("Daily check-in scheduled")).toBeTruthy();
    });
  });

  it("keeps cancellation visible after an enabled reminder loads", async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, time: "09:00", notificationId: "reminder-1" });
    const view = await renderScreen();

    await waitFor(() => {
      expect(view.getByText("Scheduled for 09:00")).toBeTruthy();
      expect(view.getByLabelText("Turn off daily reminder")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Turn off daily reminder"));
    });

    await waitFor(() => {
      expect(mockDisable).toHaveBeenCalledWith("user-1");
      expect(view.getByText("Daily check-in turned off")).toBeTruthy();
    });
  });
});

function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference="light">
        <NotificationSettingsScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
