import { ApiClientError } from "@living-nutrition/api-client";

export type UserFacingApiError = {
  body: string;
  isNetworkIssue: boolean;
};

/** Converts transport metadata into safe phone copy without dropping support IDs. */
export function presentApiError(error: unknown, fallback: string): UserFacingApiError {
  if (error instanceof ApiClientError) {
    if (error.code === "network_unavailable" || error.status === 0) {
      return {
        body: "We couldn't reach Living Nutrition. Check that the API server is running and your phone is on the same Wi-Fi, then try again.",
        isNetworkIssue: true,
      };
    }

    if (error.code === "rate_limited" || error.status === 429) {
      return {
        body: appendRequestId("Too many requests were sent. Wait a moment, then try again.", error.requestId),
        isNetworkIssue: false,
      };
    }

    if (error.code === "nutrition_provider_unavailable") {
      return {
        body: appendRequestId(
          "Nutrition records are temporarily unavailable. Please try again shortly.",
          error.requestId
        ),
        isNetworkIssue: false,
      };
    }

    if (error.status >= 500) {
      return {
        body: appendRequestId(fallback, error.requestId),
        isNetworkIssue: false,
      };
    }

    return {
      body: appendRequestId(error.message || fallback, error.requestId),
      isNetworkIssue: false,
    };
  }

  if (error instanceof Error && error.message.includes("Cannot reach the nutrition API")) {
    return {
      body: "We couldn't reach Living Nutrition. Check that the API server is running and your phone is on the same Wi-Fi, then try again.",
      isNetworkIssue: true,
    };
  }

  return { body: fallback, isNetworkIssue: false };
}

function appendRequestId(message: string, requestId?: string) {
  return requestId ? `${message} Reference: ${requestId}.` : message;
}
