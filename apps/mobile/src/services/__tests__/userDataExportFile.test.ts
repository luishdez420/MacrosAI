import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { UserDataExport } from "@living-nutrition/shared-types";

import { shareUserDataExport, userDataExportFileName } from "../userDataExportFile";

const mockCreate = jest.fn();
const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockShareAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();

jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache" },
  File: jest.fn(() => ({
    uri: "file:///cache/living-nutrition-export.json",
    exists: true,
    create: mockCreate,
    write: mockWrite,
    delete: mockDelete,
  })),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

describe("shareUserDataExport", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockWrite.mockReset();
    mockDelete.mockReset();
    mockShareAsync.mockReset();
    mockIsAvailableAsync.mockReset();
    (File as unknown as jest.Mock).mockClear();
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it("creates a cache-only JSON file, shares it, then removes it", async () => {
    const data = exportData();
    const result = await shareUserDataExport(data, new Date("2026-07-14T12:00:00.000Z"));

    expect(result).toEqual({ status: "shared", fileName: "living-nutrition-export-2026-07-14T12-00-00-000Z.json" });
    expect(File).toHaveBeenCalledWith(Paths.cache, result.fileName);
    expect(mockCreate).toHaveBeenCalledWith({ overwrite: true });
    expect(mockWrite).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    expect(mockShareAsync).toHaveBeenCalledWith("file:///cache/living-nutrition-export.json", {
      mimeType: "application/json",
      UTI: "public.json",
      dialogTitle: "Export Living Nutrition data",
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("removes the temporary file when sharing is unavailable", async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(shareUserDataExport(exportData())).resolves.toMatchObject({ status: "unavailable" });
    expect(mockShareAsync).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("uses a privacy-neutral filename without account identifiers", () => {
    expect(userDataExportFileName(new Date("2026-07-14T12:00:00.000Z"))).toBe(
      "living-nutrition-export-2026-07-14T12-00-00-000Z.json"
    );
  });
});

function exportData(): UserDataExport {
  return {
    formatVersion: "living-nutrition-export/v1",
    generatedAt: "2026-07-14T12:00:00Z",
    user: { id: "user-1", email: "person@example.com", displayName: "Person", token: "", authScheme: "jwt" },
    preferences: {
      id: "preferences-1",
      locale: "en-US",
      unitSystem: "us",
      dayStartTime: "00:00",
      timezone: "UTC",
      goalDirection: "maintain",
      onboardingGoal: "maintain_rhythm",
      loggingPreference: "package_labels",
      dietaryPreferences: [],
      imageRetentionDays: 30,
      themePreference: "light",
      createdAt: "2026-07-14T12:00:00Z",
      updatedAt: "2026-07-14T12:00:00Z",
    },
    goals: [],
    weightEntries: [],
    hydrationEntries: [],
    meals: [],
    recipes: [],
    favoriteFoods: [],
    recentFoods: [],
    customFoods: [],
  };
}
