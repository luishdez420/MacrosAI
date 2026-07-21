import * as Sentry from "@sentry/react-native";

import {
  configureMobileErrorReporting,
  reportUnexpectedApiFailure,
  sanitizeMobileSentryEvent,
} from "../errorReporting";

describe("mobile error reporting", () => {
  it("removes identity, request, and UI context before an event is sent", () => {
    const event = sanitizeMobileSentryEvent({
      type: undefined,
      tags: { request_id: "req_mobile_123", unsafe: "private" },
      request: { url: "https://api.example.test/foods?query=private" },
      user: { id: "private-user" },
      breadcrumbs: [{ message: "private meal" }],
      contexts: { device: { name: "private phone" } },
      extra: { image: "private" },
    });

    expect(event.tags).toEqual({ request_id: "req_mobile_123" });
    expect(event.request).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.contexts).toBeUndefined();
    expect(event.extra).toBeUndefined();
  });

  it("reports only unexpected API failures with the backend request ID", () => {
    configureMobileErrorReporting({
      sentryDsn: "https://public@sentry.example.test/123",
      sentryEnvironment: "test",
    });

    reportUnexpectedApiFailure({ status: 503, code: "server_failure", requestId: "req_mobile_456" });
    reportUnexpectedApiFailure({ status: 429, code: "rate_limited", requestId: "req_mobile_ignored" });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
