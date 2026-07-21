import * as SecureStore from "expo-secure-store";

import {
  clearPendingAnalysisJob,
  loadPendingAnalysisJob,
  savePendingAnalysisJob,
} from "../pendingAnalysisJob";

jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const secureStore = jest.mocked(SecureStore);

describe("pendingAnalysisJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    secureStore.getItemAsync.mockResolvedValue(null);
    secureStore.setItemAsync.mockResolvedValue();
    secureStore.deleteItemAsync.mockResolvedValue();
  });

  it("stores only an account-scoped pending job pointer", async () => {
    await savePendingAnalysisJob("user-one", "job-one");

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "living-nutrition.pending-analysis-job",
      expect.stringContaining('"jobId":"job-one"')
    );
    const payload = JSON.parse(secureStore.setItemAsync.mock.calls[0]?.[1] ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({ ownerId: "user-one", jobId: "job-one" });
    expect(payload).not.toHaveProperty("imageBase64");
  });

  it("does not resume another account's pending analysis", async () => {
    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ ownerId: "user-one", jobId: "job-one", createdAt: "2026-07-21T00:00:00.000Z" })
    );

    await expect(loadPendingAnalysisJob("user-two")).resolves.toBeUndefined();
    await expect(loadPendingAnalysisJob("user-one")).resolves.toBe("job-one");
  });

  it("clears only the matching completed or abandoned job", async () => {
    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ ownerId: "user-one", jobId: "job-one", createdAt: "2026-07-21T00:00:00.000Z" })
    );

    await clearPendingAnalysisJob("job-two");
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();

    await clearPendingAnalysisJob("job-one");
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith("living-nutrition.pending-analysis-job");
  });
});
