import { ApiClientError, createApiClient } from "@living-nutrition/api-client";

describe("API client session refresh", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refreshes an expired access token once and retries the original request", async () => {
    let currentToken = "expired-access-token";
    const refreshAuthToken = jest.fn(async () => {
      currentToken = "fresh-access-token";
      return currentToken;
    });
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Access token expired." } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "goal_1",
            startsOn: "2026-07-09",
            caloriesKcal: 2200,
            proteinGrams: 140,
            carbohydrateGrams: 240,
            fatGrams: 70,
            fiberGrams: 28,
            sodiumMilligrams: 2300,
            createdAt: "2026-07-09T00:00:00Z",
            updatedAt: "2026-07-09T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: "http://api.example/api/v1",
      getAuthToken: async () => currentToken,
      refreshAuthToken,
    });

    const goal = await client.getGoal();

    expect(goal?.id).toBe("goal_1");
    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer expired-access-token",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh-access-token",
    });
  });

  it("does not try to refresh a failed refresh request", async () => {
    const refreshAuthToken = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Refresh expired." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: "http://api.example/api/v1",
      getAuthToken: async () => "expired-access-token",
      refreshAuthToken,
    });

    await expect(client.refreshSession("refresh-token-value")).rejects.toThrow("Refresh expired.");
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("sends the authenticated current and replacement password without attempting a refresh", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "user_1",
          email: "luis@example.com",
          displayName: "Luis",
          accessToken: "replacement-access-token",
          refreshToken: "replacement-refresh-token",
          authScheme: "jwt",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const refreshAuthToken = jest.fn();
    const client = createApiClient({
      baseUrl: "http://api.example/api/v1",
      getAuthToken: async () => "current-access-token",
      refreshAuthToken,
      getClientLabel: () => "Living Nutrition on iOS",
    });

    const session = await client.changePassword({
      currentPassword: "correct-horse-battery-staple",
      newPassword: "another-correct-horse-battery-staple",
    });

    expect(session.accessToken).toBe("replacement-access-token");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://api.example/api/v1/auth/password");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer current-access-token" },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Living-Nutrition-Client": "Living Nutrition on iOS",
    });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      currentPassword: "correct-horse-battery-staple",
      newPassword: "another-correct-horse-battery-staple",
    });
    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("preserves an analysis abort and forwards the query signal to fetch", async () => {
    const abortError = new Error("Request aborted");
    abortError.name = "AbortError";
    const fetchMock = jest.fn().mockRejectedValue(abortError);
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: "http://api.example/api/v1" });
    const controller = new AbortController();

    await expect(
      client.analyzeMealPhoto({ imageBase64: "base64-image" }, controller.signal)
    ).rejects.toBe(abortError);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it("preserves API status, code, and request ID for user-facing recovery copy", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "internal_error",
            message: "Unexpected server error.",
            requestId: "req_food_123",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: "http://api.example/api/v1" });

    await expect(client.searchFoods("banana")).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        message: "Unexpected server error.",
        status: 500,
        code: "internal_error",
        requestId: "req_food_123",
      })
    );
  });

  it("reports a 5xx response through the optional privacy-safe hook", async () => {
    const onUnexpectedServerError = jest.fn();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "internal_error",
            message: "Unexpected server error.",
            requestId: "req_food_500",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({
      baseUrl: "http://api.example/api/v1",
      onUnexpectedServerError,
    });

    await expect(client.searchFoods("banana")).rejects.toBeInstanceOf(ApiClientError);

    expect(onUnexpectedServerError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, code: "internal_error", requestId: "req_food_500" })
    );
  });

  it("forwards a caller-owned idempotency key when creating a meal", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "meal_1",
          name: "Banana",
          mealType: "snack",
          loggedAt: "2026-07-13T12:00:00Z",
          notes: null,
          items: [],
          createdAt: "2026-07-13T12:00:00Z",
          updatedAt: "2026-07-13T12:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: "http://api.example/api/v1" });

    await client.createMeal(
      {
        name: "Banana",
        mealType: "snack",
        items: [
          {
            foodId: "usda:173944",
            displayName: "Bananas, raw",
            consumedGrams: 118,
            calories: 105,
            proteinGrams: 1.3,
            carbohydrateGrams: 27,
            fatGrams: 0.4,
            sourceProvider: "usda",
            sourceExternalId: "173944",
            nutrientSnapshotJson: {},
            confidence: {
              identity: "verified",
              portion: "verified",
              nutritionRecord: "high",
              explanation: "Selected source record.",
            },
            userConfirmed: true,
            addedOilGrams: 0,
          },
        ],
      },
      { idempotencyKey: "meal-sync-001" }
    );

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "meal-sync-001",
    });
  });
});
