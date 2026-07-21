import { ApiClientError } from "@living-nutrition/api-client";

import { canQueueConfirmedMeal } from "../offlineMealSync";

describe("canQueueConfirmedMeal", () => {
  it("queues only ambiguous transport or server failures", () => {
    expect(canQueueConfirmedMeal(new ApiClientError("Offline", { status: 0 }))).toBe(true);
    expect(canQueueConfirmedMeal(new ApiClientError("Timed out", { status: 408 }))).toBe(true);
    expect(canQueueConfirmedMeal(new ApiClientError("Server error", { status: 500 }))).toBe(true);
  });

  it("does not queue authentication, validation, or rate-limit failures", () => {
    expect(canQueueConfirmedMeal(new ApiClientError("Unauthorized", { status: 401 }))).toBe(false);
    expect(canQueueConfirmedMeal(new ApiClientError("Invalid meal", { status: 422 }))).toBe(false);
    expect(canQueueConfirmedMeal(new ApiClientError("Slow down", { status: 429 }))).toBe(false);
  });
});
