import * as Sentry from "@sentry/react-native";
import type { ErrorEvent } from "@sentry/react-native";

import { env } from "../config/env";

type ReportingEnvironment = Pick<typeof env, "sentryDsn" | "sentryEnvironment">;
type ApiFailure = {
  code?: string;
  requestId?: string;
  status: number;
};

const allowedTagKeys = new Set(["api_code", "api_status", "error_source", "request_id"]);
let reportingEnabled = false;

/** Initialize only in builds explicitly configured with a public project DSN. */
export function configureMobileErrorReporting(configuration: ReportingEnvironment = env) {
  if (reportingEnabled || !configuration.sentryDsn) {
    return reportingEnabled;
  }

  Sentry.init({
    dsn: configuration.sentryDsn,
    environment: configuration.sentryEnvironment || "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: false,
    enableAutoPerformanceTracing: false,
    enableCaptureFailedRequests: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: sanitizeMobileSentryEvent,
  });
  reportingEnabled = true;
  return true;
}

/** Keep the event useful for correlation without retaining sensitive app data. */
export function sanitizeMobileSentryEvent(event: ErrorEvent): ErrorEvent {
  const safeTags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(
      ([key, value]) => allowedTagKeys.has(key) && typeof value === "string"
    )
  );

  return {
    ...event,
    tags: safeTags,
    request: undefined,
    user: undefined,
    breadcrumbs: undefined,
    contexts: undefined,
    extra: undefined,
  };
}

/** Report only unexpected API failures; recovery states remain user-visible UI. */
export function reportUnexpectedApiFailure(failure: ApiFailure) {
  if (!reportingEnabled || failure.status < 500) {
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag("error_source", "mobile_api");
    scope.setTag("api_status", String(failure.status));
    if (failure.code) scope.setTag("api_code", failure.code);
    if (failure.requestId) scope.setTag("request_id", failure.requestId);
    Sentry.captureException(new Error("Nutrition API request failed."));
  });
}
