import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;

function getHostApiBaseUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];

  return host ? `http://${host}:8000/api/v1` : undefined;
}

const configuredApiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  getHostApiBaseUrl() ||
  extra?.apiBaseUrl;

export const env = {
  apiBaseUrl: configuredApiBaseUrl || "http://localhost:8000/api/v1",
};
