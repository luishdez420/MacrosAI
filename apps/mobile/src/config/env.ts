import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as {
  apiBaseUrl?: string;
  clerkPublishableKey?: string;
  sentryDsn?: string;
  sentryEnvironment?: string;
} | undefined;

function getHostApiBaseUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(":")[0];

  return host ? `http://${host}:8000/api/v1` : undefined;
}

function isLoopbackApiUrl(value: string | undefined) {
  if (!value) return false;

  try {
    const host = new URL(value).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

const configuredEnvironmentApiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const metroHostApiUrl = getHostApiBaseUrl();
// A checked-in/local .env often uses localhost for simulators. In Expo Go on
// a physical phone, localhost is the phone, so use Metro's LAN host instead.
const configuredApiBaseUrl =
  metroHostApiUrl && isLoopbackApiUrl(configuredEnvironmentApiUrl)
    ? metroHostApiUrl
    : configuredEnvironmentApiUrl || metroHostApiUrl || extra?.apiBaseUrl;

export const env = {
  apiBaseUrl: configuredApiBaseUrl || "http://localhost:8000/api/v1",
  // This flag is compiled into a dedicated automated-test build. It is never
  // enabled by the normal phone, preview, or production start commands.
  e2eFixtureMode: process.env.EXPO_PUBLIC_E2E_FIXTURE_MODE === "true",
  clerkPublishableKey:
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || extra?.clerkPublishableKey || undefined,
  // This is a public ingestion identifier, not an authentication secret.
  // It remains unset for ordinary local/Expo Go development.
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || extra?.sentryDsn || undefined,
  sentryEnvironment:
    process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || extra?.sentryEnvironment || undefined,
};
