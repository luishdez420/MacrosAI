import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { UserPreference, UserPreferenceUpdate } from "@living-nutrition/shared-types";
import { ProfileScreen } from "../ProfileScreen";

const mockGetSession = jest.fn();
const mockRegister = jest.fn();
const mockGetGoal = jest.fn();
const mockListGoalHistory = jest.fn();
const mockGetPreferences = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockListWeightEntries = jest.fn();
const mockGetCorrectionReports = jest.fn();
const mockListAuthSessions = jest.fn();
const mockRevokeAuthSession = jest.fn();
const mockClearStoredSession = jest.fn();
const mockSignOutStoredSession = jest.fn();
const mockStoreSession = jest.fn();

jest.mock("expo-router", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

jest.mock("../../../services/api", () => ({
  api: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    getGoal: (...args: unknown[]) => mockGetGoal(...args),
    listGoalHistory: (...args: unknown[]) => mockListGoalHistory(...args),
    getPreferences: (...args: unknown[]) => mockGetPreferences(...args),
    updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
    listWeightEntries: (...args: unknown[]) => mockListWeightEntries(...args),
    getCorrectionReports: (...args: unknown[]) => mockGetCorrectionReports(...args),
    listAuthSessions: (...args: unknown[]) => mockListAuthSessions(...args),
    revokeAuthSession: (...args: unknown[]) => mockRevokeAuthSession(...args),
  },
  clearStoredSession: (...args: unknown[]) => mockClearStoredSession(...args),
  signOutStoredSession: (...args: unknown[]) => mockSignOutStoredSession(...args),
  storeSession: (...args: unknown[]) => mockStoreSession(...args),
}));

describe("ProfileScreen", () => {
  let currentPreference: UserPreference;

  beforeEach(() => {
    currentPreference = userPreference("us");
    mockGetSession.mockReset();
    mockRegister.mockReset();
    mockGetGoal.mockReset();
    mockListGoalHistory.mockReset();
    mockGetPreferences.mockReset();
    mockUpdatePreferences.mockReset();
    mockListWeightEntries.mockReset();
    mockGetCorrectionReports.mockReset();
    mockListAuthSessions.mockReset();
    mockRevokeAuthSession.mockReset();
    mockClearStoredSession.mockReset();
    mockSignOutStoredSession.mockReset();
    mockStoreSession.mockReset();

    mockGetSession.mockResolvedValue({
      id: "user_1",
      email: "luis@example.com",
      displayName: "Luis",
      token: "dev-token",
      authScheme: "local-token",
    });
    mockRegister.mockResolvedValue({
      id: "user_1",
      email: "luis@example.com",
      displayName: "Luis",
      token: "local:user_1",
      authScheme: "local",
    });
    mockGetGoal.mockResolvedValue(null);
    mockListGoalHistory.mockResolvedValue([]);
    mockGetPreferences.mockImplementation(() => Promise.resolve(currentPreference));
    mockUpdatePreferences.mockImplementation((input: UserPreferenceUpdate) => {
      currentPreference = {
        ...currentPreference,
        ...input,
        updatedAt: "2026-07-08T12:01:00Z",
      };
      return Promise.resolve(currentPreference);
    });
    mockListWeightEntries.mockResolvedValue([]);
    mockGetCorrectionReports.mockResolvedValue({ items: [] });
    mockListAuthSessions.mockResolvedValue({ items: [] });
  });

  afterEach(cleanup);

  it("lets users switch profile height and weight inputs between US and metric units", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Goal recommendation")).toBeTruthy();
    });

    expect(view.getByText("Height (ft)")).toBeTruthy();
    expect(view.getByText("Height (in)")).toBeTruthy();
    expect(view.getByText("Weight (lb)")).toBeTruthy();
    expect(view.getByDisplayValue("176")).toBeTruthy();
    expect(view.getByText("Goal effective date")).toBeTruthy();
    expect(view.getByLabelText("Use U.S. measurements").props.accessibilityState.selected).toBe(true);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Use metric measurements"));
    });

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ unitSystem: "metric" });
    });

    expect(view.getByText("Height (cm)")).toBeTruthy();
    expect(view.getByText("Weight (kg)")).toBeTruthy();
    expect(view.getByDisplayValue("175")).toBeTruthy();
    expect(view.getByDisplayValue("79.8")).toBeTruthy();
    expect(view.getByText("About 5 ft 9 in and 176 lb in US units.")).toBeTruthy();
    expect(view.getByLabelText("Use metric measurements").props.accessibilityState.selected).toBe(true);

    await act(async () => {
      fireEvent.press(view.getByLabelText("Use U.S. measurements"));
    });

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ unitSystem: "us" });
    });

    expect(view.getByText("Height (ft)")).toBeTruthy();
    expect(view.getByText("Height (in)")).toBeTruthy();
    expect(view.getByText("Weight (lb)")).toBeTruthy();
    expect(view.getByDisplayValue("5")).toBeTruthy();
    expect(view.getByDisplayValue("9")).toBeTruthy();
    expect(view.getByDisplayValue("175.9")).toBeTruthy();
  });

  it("shows a secure local password field for profile auth", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByDisplayValue("Luis")).toBeTruthy();
    });

    expect(view.getByLabelText("Password").props.secureTextEntry).toBe(true);
    expect(view.getByText(/Local passwords are hashed/)).toBeTruthy();
    expect(view.getByText(/short-lived access tokens with refresh rotation/)).toBeTruthy();
  });

  it("shows active local sessions and distinguishes the current device", async () => {
    mockGetSession.mockResolvedValue({
      id: "user_1",
      email: "luis@example.com",
      displayName: "Luis",
      token: "jwt-token",
      authScheme: "jwt",
    });
    mockListAuthSessions.mockResolvedValue({
      items: [
        {
          id: "session_current",
          deviceLabel: "Living Nutrition on iOS",
          createdAt: "2026-07-09T12:00:00Z",
          lastUsedAt: null,
          expiresAt: "2026-08-08T12:00:00Z",
          isCurrent: true,
        },
        {
          id: "session_other",
          deviceLabel: "Living Nutrition on Android",
          createdAt: "2026-07-08T12:00:00Z",
          lastUsedAt: "2026-07-09T10:00:00Z",
          expiresAt: "2026-08-07T12:00:00Z",
          isCurrent: false,
        },
      ],
    });

    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Active sessions")).toBeTruthy();
      expect(view.getByText("Living Nutrition on iOS")).toBeTruthy();
      expect(view.getByText("Living Nutrition on Android")).toBeTruthy();
    });

    expect(view.getByText("Current")).toBeTruthy();
    expect(view.getByText("Active")).toBeTruthy();
    expect(view.getByLabelText("Revoke another active session")).toBeTruthy();
  });

  it("renders accessible secure controls for a signed-in local account", async () => {
    mockGetSession.mockResolvedValue({
      id: "user_1",
      email: "luis@example.com",
      displayName: "Luis",
      token: "jwt-token",
      authScheme: "jwt",
    });

    const view = await renderWithQueryClient(<ProfileScreen />);
    await waitFor(() => {
      expect(view.getByLabelText("Current password")).toBeTruthy();
    });
    const currentPassword = view.getByLabelText("Current password");
    const newPassword = view.getByLabelText("New password");
    const confirmation = view.getByLabelText("Confirm new password");

    expect(currentPassword.props.secureTextEntry).toBe(true);
    expect(newPassword.props.secureTextEntry).toBe(true);
    expect(confirmation.props.secureTextEntry).toBe(true);
    expect(view.getByLabelText("Update password").props.accessibilityHint).toBe(
      "Updates your local password and signs out other devices"
    );
  });

  it("shows the effective-date goal schedule returned by the API", async () => {
    mockListGoalHistory.mockResolvedValue([
      { id: "goal_future", startsOn: "2026-08-01", caloriesKcal: 2200, proteinGrams: 155, carbohydrateGrams: 260, fatGrams: 65, fiberGrams: null, sodiumMilligrams: null, createdAt: "2026-07-12T12:00:00Z", updatedAt: "2026-07-12T12:00:00Z" },
      { id: "goal_current", startsOn: "2026-07-12", caloriesKcal: 2400, proteinGrams: 160, carbohydrateGrams: 280, fatGrams: 70, fiberGrams: null, sodiumMilligrams: null, createdAt: "2026-07-12T12:00:00Z", updatedAt: "2026-07-12T12:00:00Z" },
    ]);
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Goal schedule")).toBeTruthy();
      expect(view.getByText("2 revisions")).toBeTruthy();
      expect(view.getByText("2200 kcal · 155g protein")).toBeTruthy();
      expect(view.getByText("2400 kcal · 160g protein")).toBeTruthy();
    });
  });

  it("persists the chosen appearance preference", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Appearance")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Dark theme"));
    });

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ themePreference: "dark" });
    });
  });

  it("lets users revise their onboarding and dietary preferences without claiming filtering", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Your logging rhythm")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Build strength"));
    });
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        onboardingGoal: "build_strength",
        goalDirection: "gain",
      });
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("kitchen scale"));
    });
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ loggingPreference: "kitchen_scale" });
    });

    expect(view.getByText(/do not filter food matches, verify ingredients or allergens/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText("Vegetarian"));
    });
    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ dietaryPreferences: ["vegetarian"] });
    });
  });

  it("keeps dietary preference controls usable when a legacy response omits the list", async () => {
    currentPreference = {
      ...currentPreference,
      dietaryPreferences: undefined as unknown as UserPreference["dietaryPreferences"],
    };

    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Dietary preferences")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText("Vegan"));
    });

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ dietaryPreferences: ["vegan"] });
    });
  });

  it("keeps weight entry controls visually separated from trend feedback", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Weight tracker")).toBeTruthy();
    });

    expect(view.getByTestId("weight-entry-form")).toBeTruthy();
    expect(view.getByTestId("weight-feedback")).toBeTruthy();
  });
});

function userPreference(unitSystem: "us" | "metric"): UserPreference {
  return {
    id: "pref_1",
    locale: "en-US",
    unitSystem,
    dayStartTime: "00:00",
    timezone: "America/New_York",
    goalDirection: "maintain",
    onboardingGoal: null,
    loggingPreference: null,
    dietaryPreferences: [],
    themePreference: "system",
    imageRetentionDays: 30,
    createdAt: "2026-07-08T12:00:00Z",
    updatedAt: "2026-07-08T12:00:00Z",
  };
}

function renderWithQueryClient(element: ReactElement) {
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
        {element}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
