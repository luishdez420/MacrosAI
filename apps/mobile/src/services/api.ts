import * as SecureStore from "expo-secure-store";

import { createApiClient } from "@living-nutrition/api-client";
import type { UserSession } from "@living-nutrition/shared-types";
import { env } from "../config/env";

const authTokenKey = "living-nutrition.auth-token";
const refreshTokenKey = "living-nutrition.refresh-token";
let refreshInFlight: Promise<string | undefined> | undefined;

export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  getAuthToken: getStoredAuthToken,
  refreshAuthToken: refreshStoredAccessToken,
});

export async function getStoredAuthToken() {
  return (await SecureStore.getItemAsync(authTokenKey)) ?? undefined;
}

export async function getStoredRefreshToken() {
  return (await SecureStore.getItemAsync(refreshTokenKey)) ?? undefined;
}

export async function storeSession(session: UserSession) {
  const accessToken = session.accessToken ?? session.token;

  if (accessToken) {
    await SecureStore.setItemAsync(authTokenKey, accessToken);
  }

  if (session.refreshToken) {
    await SecureStore.setItemAsync(refreshTokenKey, session.refreshToken);
  }
}

export async function clearStoredSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(authTokenKey),
    SecureStore.deleteItemAsync(refreshTokenKey),
  ]);
}

export async function signOutStoredSession() {
  const refreshToken = await getStoredRefreshToken();

  try {
    if (refreshToken) {
      await api.logout(refreshToken);
    }
  } finally {
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
