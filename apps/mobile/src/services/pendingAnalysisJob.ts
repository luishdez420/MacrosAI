import * as SecureStore from "expo-secure-store";

const pendingAnalysisJobKey = "living-nutrition.pending-analysis-job";

type PendingAnalysisJob = {
  ownerId: string;
  jobId: string;
  createdAt: string;
};

/**
 * Retains only an account-scoped job pointer. Meal photos remain in the
 * backend's private temporary storage and are never copied into this record.
 */
export async function savePendingAnalysisJob(ownerId: string, jobId: string) {
  await SecureStore.setItemAsync(
    pendingAnalysisJobKey,
    JSON.stringify({ ownerId, jobId, createdAt: new Date().toISOString() } satisfies PendingAnalysisJob)
  );
}

export async function loadPendingAnalysisJob(ownerId: string) {
  const serialized = await SecureStore.getItemAsync(pendingAnalysisJobKey);
  if (!serialized) {
    return undefined;
  }

  try {
    const pending = JSON.parse(serialized) as Partial<PendingAnalysisJob>;
    if (pending.ownerId !== ownerId || typeof pending.jobId !== "string" || !pending.jobId) {
      return undefined;
    }
    return pending.jobId;
  } catch {
    return undefined;
  }
}

export async function clearPendingAnalysisJob(jobId?: string) {
  if (!jobId) {
    await SecureStore.deleteItemAsync(pendingAnalysisJobKey);
    return;
  }

  const serialized = await SecureStore.getItemAsync(pendingAnalysisJobKey);
  if (!serialized) {
    return;
  }
  try {
    const pending = JSON.parse(serialized) as Partial<PendingAnalysisJob>;
    if (pending.jobId === jobId) {
      await SecureStore.deleteItemAsync(pendingAnalysisJobKey);
    }
  } catch {
    await SecureStore.deleteItemAsync(pendingAnalysisJobKey);
  }
}
