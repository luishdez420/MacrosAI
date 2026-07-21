import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { UserDataExport } from "@living-nutrition/shared-types";

export type UserDataExportShareResult =
  | { status: "shared"; fileName: string }
  | { status: "unavailable"; fileName: string };

/**
 * Creates the export in cache only for the native share flow, then removes it.
 * Export files intentionally do not persist in the app's document directory.
 */
export async function shareUserDataExport(
  exportData: UserDataExport,
  now = new Date()
): Promise<UserDataExportShareResult> {
  const fileName = userDataExportFileName(now);
  const file = new File(Paths.cache, fileName);
  let created = false;

  try {
    file.create({ overwrite: true });
    created = true;
    file.write(JSON.stringify(exportData, null, 2));

    if (!(await Sharing.isAvailableAsync())) {
      return { status: "unavailable", fileName };
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Export Living Nutrition data",
    });
    return { status: "shared", fileName };
  } finally {
    if (created) {
      try {
        if (file.exists) {
          file.delete();
        }
      } catch {
        // Cache cleanup is best-effort and must not hide a completed share action.
      }
    }
  }
}

export function userDataExportFileName(now: Date) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `living-nutrition-export-${timestamp}.json`;
}
