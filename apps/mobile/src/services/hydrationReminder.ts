import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type HydrationReminderSettings = {
  enabled: boolean;
  time: string;
  notificationId: string | null;
};

export type ReminderPermissionResult =
  | { status: "enabled"; settings: HydrationReminderSettings }
  | { status: "denied"; settings: HydrationReminderSettings };

const defaultSettings: HydrationReminderSettings = {
  enabled: false,
  time: "15:00",
  notificationId: null,
};

function storageKey(accountScope?: string) {
  return `living-nutrition.hydration-reminder.v1.${accountScope || "anonymous"}`;
}

/** Configure foreground delivery once at app startup. System notification settings remain authoritative. */
export function configureNotificationPresentation() {
  if (Platform.OS === "web") {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getHydrationReminderSettings(accountScope?: string): Promise<HydrationReminderSettings> {
  const stored = await SecureStore.getItemAsync(storageKey(accountScope));

  if (!stored) {
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<HydrationReminderSettings>;
    const time = normalizeReminderTime(parsed.time);

    return {
      enabled: parsed.enabled === true,
      time,
      notificationId: typeof parsed.notificationId === "string" ? parsed.notificationId : null,
    };
  } catch {
    return defaultSettings;
  }
}

export async function enableHydrationReminder(
  time: string,
  accountScope?: string
): Promise<ReminderPermissionResult> {
  ensureNativeNotifications();

  const normalizedTime = normalizeReminderTime(time);
  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: false },
      });
  const current = await getHydrationReminderSettings(accountScope);

  if (!permission.granted) {
    return {
      status: "denied",
      settings: { ...current, enabled: false, time: normalizedTime },
    };
  }

  if (current.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(current.notificationId).catch(() => undefined);
  }

  const { hour, minute } = splitReminderTime(normalizedTime);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: "A gentle hydration check-in",
      body: "If it sounds useful, take a moment to log water or continue your day.",
      data: { destination: "today", reminder: "hydration" },
    },
    trigger:
      Platform.OS === "ios"
        ? {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour,
            minute,
            repeats: true,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour,
            minute,
          },
  });
  const settings: HydrationReminderSettings = {
    enabled: true,
    time: normalizedTime,
    notificationId,
  };
  await persistSettings(settings, accountScope);

  return { status: "enabled", settings };
}

export async function disableHydrationReminder(accountScope?: string) {
  const current = await getHydrationReminderSettings(accountScope);

  if (current.notificationId && Platform.OS !== "web") {
    await Notifications.cancelScheduledNotificationAsync(current.notificationId).catch(() => undefined);
  }

  const settings: HydrationReminderSettings = {
    ...current,
    enabled: false,
    notificationId: null,
  };
  await persistSettings(settings, accountScope);
  return settings;
}

export async function clearHydrationReminder(accountScope?: string) {
  await disableHydrationReminder(accountScope);
  await SecureStore.deleteItemAsync(storageKey(accountScope));
}

export function normalizeReminderTime(value: unknown) {
  if (typeof value !== "string") {
    return defaultSettings.time;
  }

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return defaultSettings.time;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return defaultSettings.time;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isValidReminderTime(value: string) {
  return normalizeReminderTime(value) === value;
}

export function formatReminderTime(value: string) {
  const { hour, minute } = splitReminderTime(normalizeReminderTime(value));
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, hour, minute));
}

function splitReminderTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour: hour ?? 15, minute: minute ?? 0 };
}

async function persistSettings(settings: HydrationReminderSettings, accountScope?: string) {
  await SecureStore.setItemAsync(storageKey(accountScope), JSON.stringify(settings));
}

function ensureNativeNotifications() {
  if (Platform.OS === "web") {
    throw new Error("Daily reminders are available in the iOS or Android app, not in the web preview.");
  }
}
