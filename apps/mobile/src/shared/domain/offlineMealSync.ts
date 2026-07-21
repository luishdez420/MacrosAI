import { ApiClientError } from "@living-nutrition/api-client";

/** Only ambiguous transport/server failures are safe to retry with an idempotency key. */
export function canQueueConfirmedMeal(error: unknown) {
  return error instanceof ApiClientError && (error.status === 0 || error.status === 408 || error.status >= 500);
}
