import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DataControlsScreen } from "../DataControlsScreen";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";

const mockGetPreferences = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockExportUserData = jest.fn();
const mockDeleteAccount = jest.fn();
const mockListSecurityActivity = jest.fn();
const mockShareUserDataExport = jest.fn();
const mockGetStoredUserId = jest.fn();
const mockClearStoredSession = jest.fn();
const mockClearQueuedMeals = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    getPreferences: () => mockGetPreferences(),
    updatePreferences: (input: unknown) => mockUpdatePreferences(input),
    exportUserData: () => mockExportUserData(),
    deleteAccount: () => mockDeleteAccount(),
    listSecurityActivity: () => mockListSecurityActivity(),
  },
  getStoredUserId: () => mockGetStoredUserId(),
  clearStoredSession: () => mockClearStoredSession(),
}));

jest.mock("../../../services/offlineMealQueue", () => ({
  clearQueuedMeals: (ownerId: string) => mockClearQueuedMeals(ownerId),
}));

jest.mock("../../../services/userDataExportFile", () => ({
  shareUserDataExport: (data: unknown) => mockShareUserDataExport(data),
}));

describe("DataControlsScreen", () => {
  beforeEach(() => {
    mockGetPreferences.mockReset();
    mockUpdatePreferences.mockReset();
    mockExportUserData.mockReset();
    mockDeleteAccount.mockReset();
    mockListSecurityActivity.mockReset();
    mockShareUserDataExport.mockReset();
    mockGetStoredUserId.mockReset();
    mockClearStoredSession.mockReset();
    mockClearQueuedMeals.mockReset();
    mockBack.mockReset();
    mockReplace.mockReset();

    mockGetPreferences.mockResolvedValue(preferences());
    mockUpdatePreferences.mockImplementation((input: { imageRetentionDays?: number }) =>
      Promise.resolve({ ...preferences(), ...input })
    );
    mockExportUserData.mockResolvedValue(exportData());
    mockDeleteAccount.mockResolvedValue(undefined);
    mockListSecurityActivity.mockResolvedValue({
      items: [
        { id: "activity-1", eventType: "auth.login", outcome: "success", createdAt: "2026-07-14T12:00:00Z" },
        { id: "activity-2", eventType: "user_data.export", outcome: "success", createdAt: "2026-07-14T12:01:00Z" },
      ],
    });
    mockShareUserDataExport.mockResolvedValue({
      status: "shared",
      fileName: "living-nutrition-export-2026-07-14T12-00-00-000Z.json",
    });
    mockGetStoredUserId.mockResolvedValue("user-data-controls");
    mockClearStoredSession.mockResolvedValue(undefined);
    mockClearQueuedMeals.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("saves an explicit meal-photo retention preference while preserving temporary cleanup", async () => {
    const view = await renderScreen();
    await view.findByText("Image-retention preference");
    await view.findByDisplayValue("30");
    expect(view.getByText(/Temporary meal-analysis inputs are normalized and stored privately only through the short review window/)).toBeTruthy();
    expect(view.getByText("Photos are never retained automatically")).toBeTruthy();

    fireEvent.changeText(view.getByLabelText("Preferred image retention days"), "400");
    await view.findByDisplayValue("400");
    fireEvent.press(view.getByLabelText("Save retention preference"));
    await view.findByText("Retention preference needs attention");
    expect(mockUpdatePreferences).not.toHaveBeenCalled();

    fireEvent.changeText(view.getByLabelText("Preferred image retention days"), "14");
    await view.findByDisplayValue("14");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Save retention preference"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ imageRetentionDays: 14 });
      expect(view.getByText("Retention preference saved")).toBeTruthy();
    });
    expect(view.getByText(/never changes temporary analysis-input cleanup/)).toBeTruthy();
  });

  it("shows a transparent summary when the current API prepares a JSON export", async () => {
    const view = await renderScreen();
    await view.findByText("JSON data export");
    await view.findByDisplayValue("30");

    await act(async () => {
      fireEvent.press(view.getByLabelText("Prepare JSON export"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(view.getAllByText("JSON export prepared")).toHaveLength(2);
      expect(view.getByText("Export snapshot ready")).toBeTruthy();
      expect(view.getByText("Meals: 2")).toBeTruthy();
      expect(view.getByText("Recipes: 1")).toBeTruthy();
      expect(view.getByText("Saved foods: 3")).toBeTruthy();
    });
    expect(view.getByLabelText("Share JSON export")).toBeTruthy();
    expect(view.getByText(/temporary file is removed from the app cache afterward/)).toBeTruthy();
  });

  it("shares a prepared JSON export through a temporary cache file flow", async () => {
    const view = await renderScreen();
    await view.findByText("JSON data export");
    await view.findByDisplayValue("30");

    await act(async () => {
      fireEvent.press(view.getByLabelText("Prepare JSON export"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await view.findByLabelText("Share JSON export");
    expect(view.getByLabelText("Share JSON export").props.accessibilityState.disabled).toBe(true);

    await act(async () => {
      fireEvent.press(view.getByLabelText("I understand the export may contain sensitive nutrition data"));
    });
    expect(view.getByLabelText("Share JSON export").props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Share JSON export"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(mockShareUserDataExport).toHaveBeenCalledWith(exportData());
      expect(view.getByText("Export shared")).toBeTruthy();
    });
    expect(view.getByText(/temporary JSON export file was removed from the app cache/)).toBeTruthy();
  });

  it("requires DELETE before removing the Living Nutrition profile and clears account-scoped queued meals", async () => {
    const view = await renderScreen();
    await view.findByText("Delete Living Nutrition profile");
    await view.findByDisplayValue("30");

    fireEvent.press(view.getByLabelText("Review profile deletion"));
    await view.findByText("Confirm permanent profile deletion");
    expect(view.getByText(/does not delete your Clerk identity/)).toBeTruthy();
    expect(view.getByLabelText("Delete Living Nutrition profile").props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(view.getByLabelText("Type DELETE to confirm Living Nutrition profile deletion"), "DELETE");
    await view.findByDisplayValue("DELETE");
    await act(async () => {
      fireEvent.press(view.getByLabelText("Delete Living Nutrition profile"));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
      expect(mockClearQueuedMeals).toHaveBeenCalledWith("user-data-controls");
      expect(mockClearStoredSession).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("shows safe recent security activity without exposing internal audit fields", async () => {
    const view = await renderScreen();
    await view.findByText("Security activity");
    await view.findByDisplayValue("30");

    await waitFor(() => {
      expect(view.getByText("Signed in")).toBeTruthy();
      expect(view.getByText("JSON export prepared")).toBeTruthy();
    });
    expect(view.getByLabelText(/Signed in\. Completed\./)).toBeTruthy();
    expect(view.getByText(/never shows credentials, tokens, device fingerprints/i)).toBeTruthy();
  });
});

async function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ThemeProvider initialPreference="light">
          <DataControlsScreen />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function preferences() {
  return {
    unitSystem: "us" as const,
    goalDirection: "maintain" as const,
    onboardingGoal: "maintain_rhythm" as const,
    loggingPreference: "package_labels" as const,
    dietaryPreferences: [],
    imageRetentionDays: 30,
    themePreference: "light" as const,
    updatedAt: "2026-07-14T12:00:00Z",
  };
}

function exportData() {
  return {
    formatVersion: "living-nutrition-export/v1" as const,
    generatedAt: "2026-07-14T12:00:00Z",
    user: { id: "user-data-controls", email: "person@example.com", displayName: "Person", token: "", authScheme: "jwt" },
    preferences: preferences(),
    goals: [],
    weightEntries: [{ loggedOn: "2026-07-14", weightGrams: 70000, notes: null, createdAt: "2026-07-14T12:00:00Z", updatedAt: "2026-07-14T12:00:00Z" }],
    hydrationEntries: [{ loggedOn: "2026-07-14", milliliters: 500, createdAt: "2026-07-14T12:00:00Z", updatedAt: "2026-07-14T12:00:00Z" }],
    meals: [{ id: "meal-1" }, { id: "meal-2" }],
    recipes: [{ id: "recipe-1" }],
    favoriteFoods: [{ id: "favorite-1" }],
    recentFoods: [{ id: "recent-1" }],
    customFoods: [{ id: "custom-1" }],
  };
}
