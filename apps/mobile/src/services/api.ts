import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { createApiClient } from "@living-nutrition/api-client";
import type { UserSession } from "@living-nutrition/shared-types";
import { env } from "../config/env";
import { clearHydrationReminder } from "./hydrationReminder";
import { reportUnexpectedApiFailure } from "./errorReporting";

const authTokenKey = "living-nutrition.auth-token";
const refreshTokenKey = "living-nutrition.refresh-token";
const authUserIdKey = "living-nutrition.auth-user-id";
let refreshInFlight: Promise<string | undefined> | undefined;
type ManagedAuthBridge = {
  getToken: () => Promise<string | null>;
  getUserId: () => string | null;
  signOut: () => Promise<void>;
};
let managedAuthBridge: ManagedAuthBridge | undefined;

export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  getAuthToken: getStoredAuthToken,
  refreshAuthToken: refreshStoredAccessToken,
  getClientLabel: () => {
    if (Platform.OS === "ios") return "Living Nutrition on iOS";
    if (Platform.OS === "android") return "Living Nutrition on Android";
    return "Living Nutrition on web";
  },
  onUnexpectedServerError: reportUnexpectedApiFailure,
});

export function configureManagedAuth(bridge: ManagedAuthBridge | undefined) {
  managedAuthBridge = bridge;
}

export function isManagedAuthActive() {
  return Boolean(managedAuthBridge);
}

export async function getStoredAuthToken() {
  if (managedAuthBridge) {
    return (await managedAuthBridge.getToken()) ?? undefined;
  }

  return (await SecureStore.getItemAsync(authTokenKey)) ?? undefined;
}

export async function getStoredRefreshToken() {
  return (await SecureStore.getItemAsync(refreshTokenKey)) ?? undefined;
}

/** A non-secret account scope keeps queued meals from crossing local accounts. */
export async function getStoredUserId() {
  if (managedAuthBridge) {
    return managedAuthBridge.getUserId() ?? undefined;
  }

  return (await SecureStore.getItemAsync(authUserIdKey)) ?? undefined;
}

export async function storeSession(session: UserSession) {
  const accessToken = session.accessToken ?? session.token;

  if (accessToken) {
    await SecureStore.setItemAsync(authTokenKey, accessToken);
  }

  if (session.refreshToken) {
    await SecureStore.setItemAsync(refreshTokenKey, session.refreshToken);
  }

  if (session.id) {
    await SecureStore.setItemAsync(authUserIdKey, session.id);
  }
}

export async function clearStoredSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(authTokenKey),
    SecureStore.deleteItemAsync(refreshTokenKey),
    SecureStore.deleteItemAsync(authUserIdKey),
  ]);
}

export async function signOutStoredSession() {
  const userId = await getStoredUserId();
  const refreshToken = await getStoredRefreshToken();

  try {
    if (managedAuthBridge) {
      await managedAuthBridge.signOut();
    } else if (refreshToken) {
      await api.logout(refreshToken);
    }
  } finally {
    await clearHydrationReminder(userId).catch(() => undefined);
    await clearStoredSession();
  }
}

async function refreshStoredAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken();
  }

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
}

async function refreshAccessToken() {
  if (managedAuthBridge) {
    return getStoredAuthToken();
  }

  const refreshToken = await getStoredRefreshToken();

  if (!refreshToken) {
    return undefined;
  }

  try {
    const session = await api.refreshSession(refreshToken);
    await storeSession(session);
    return session.accessToken ?? session.token ?? undefined;
  } catch {
    await clearStoredSession();
    return undefined;
  }
}
