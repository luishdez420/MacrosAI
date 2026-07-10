import { createApiClient } from "@living-nutrition/api-client";

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
});
