import { ApiClientError } from "@living-nutrition/api-client";

import { presentApiError } from "../apiErrorPresentation";

describe("presentApiError", () => {
  it("replaces internal server wording with a retryable user message and reference", () => {
    expect(
      presentApiError(
        new ApiClientError("Unexpected server error.", {
          status: 500,
          code: "internal_error",
          requestId: "req_scan_42",
        }),
        "We couldn't analyze this meal right now. Try again in a moment."
      )
    ).toEqual({
      body: "We couldn't analyze this meal right now. Try again in a moment. Reference: req_scan_42.",
      isNetworkIssue: false,
    });
  });

  it("gives network problems a phone-specific recovery path", () => {
    expect(
      presentApiError(
        new ApiClientError("Cannot reach the nutrition API.", {
          status: 0,
          code: "network_unavailable",
        }),
        "Fallback"
      )
    ).toEqual({
      body: "We couldn't reach Living Nutrition. Check that the API server is running and your phone is on the same Wi-Fi, then try again.",
      isNetworkIssue: true,
    });
  });

  it("explains nutrition provider outages without exposing provider internals", () => {
    expect(
      presentApiError(
        new ApiClientError("Internal provider error", {
          status: 503,
          code: "nutrition_provider_unavailable",
          requestId: "req_food_42",
        }),
        "Fallback"
      )
    ).toEqual({
      body: "Nutrition records are temporarily unavailable. Please try again shortly. Reference: req_food_42.",
      isNetworkIssue: false,
    });
  });
});
