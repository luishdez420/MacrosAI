import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import {
  disableHydrationReminder,
  enableHydrationReminder,
  formatReminderTime,
  getHydrationReminderSettings,
  normalizeReminderTime,
} from "../hydrationReminder";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: {
    CALENDAR: "calendar",
    DAILY: "daily",
  },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const mockNotifications = jest.mocked(Notifications);
const mockSecureStore = jest.mocked(SecureStore);

describe("hydrationReminder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockSecureStore.setItemAsync.mockResolvedValue();
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true } as never);
    mockNotifications.scheduleNotificationAsync.mockResolvedValue("scheduled-reminder");
    mockNotifications.cancelScheduledNotificationAsync.mockResolvedValue();
  });

  it("recovers safely from malformed local settings", async () => {
    mockSecureStore.getItemAsync.mockResolvedValue("not-json");

    await expect(getHydrationReminderSettings("user-1")).resolves.toEqual({
      enabled: false,
      time: "15:00",
      notificationId: null,
    });
  });

  it("asks for permission only when needed and stores a scheduled daily reminder", async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);

    const result = await enableHydrationReminder("9:05", "user-1");

    expect(result).toEqual({
      status: "enabled",
      settings: { enabled: true, time: "09:05", notificationId: "scheduled-reminder" },
    });
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: "A gentle hydration check-in" }),
      })
    );
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      "living-nutrition.hydration-reminder.v1.user-1",
      JSON.stringify({ enabled: true, time: "09:05", notificationId: "scheduled-reminder" })
    );
  });

  it("does not schedule a reminder when the user declines permission", async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false } as never);
    mockNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false } as never);

    const result = await enableHydrationReminder("15:00", "user-1");

    expect(result.status).toBe("denied");
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("cancels the existing local schedule when it is turned off", async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ enabled: true, time: "19:00", notificationId: "previous-reminder" })
    );

    await expect(disableHydrationReminder("user-1")).resolves.toEqual({
      enabled: false,
      time: "19:00",
      notificationId: null,
    });
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("previous-reminder");
  });

  it("normalizes and formats only valid local times", () => {
    expect(normalizeReminderTime("9:05")).toBe("09:05");
    expect(normalizeReminderTime("25:00")).toBe("15:00");
    expect(formatReminderTime("09:05")).not.toBe("09:05");
  });
});
