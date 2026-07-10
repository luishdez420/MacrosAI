import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { UserPreference, UserPreferenceUpdate } from "@living-nutrition/shared-types";
import { ProfileScreen } from "../ProfileScreen";

const mockGetSession = jest.fn();
const mockRegister = jest.fn();
const mockGetGoal = jest.fn();
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

  it("lets users switch profile height and weight inputs between US and metric units", async () => {
    const view = await renderWithQueryClient(<ProfileScreen />);

    await waitFor(() => {
      expect(view.getByText("Goal recommendation")).toBeTruthy();
    });

    expect(view.getByText("Height (ft)")).toBeTruthy();
    expect(view.getByText("Height (in)")).toBeTruthy();
    expect(view.getByText("Weight (lb)")).toBeTruthy();
    expect(view.getByDisplayValue("176")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("Metric"));
    });

    await waitFor(() => {
      expect(mockUpdatePreferences).toHaveBeenCalledWith({ unitSystem: "metric" });
    });

    expect(view.getByText("Height (cm)")).toBeTruthy();
    expect(view.getByText("Weight (kg)")).toBeTruthy();
    expect(view.getByDisplayValue("175")).toBeTruthy();
    expect(view.getByDisplayValue("79.8")).toBeTruthy();
    expect(view.getByText("About 5 ft 9 in and 176 lb in US units.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText("US"));
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
          createdAt: "2026-07-09T12:00:00Z",
          lastUsedAt: null,
          expiresAt: "2026-08-08T12:00:00Z",
          isCurrent: true,
        },
        {
          id: "session_other",
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
      expect(view.getByText("This device")).toBeTruthy();
      expect(view.getByText("Other device")).toBeTruthy();
    });

    expect(view.getByText("Current")).toBeTruthy();
    expect(view.getByText("Active")).toBeTruthy();
    expect(view.getByLabelText("Revoke another active session")).toBeTruthy();
  });
});

function userPreference(unitSystem: "us" | "metric"): UserPreference {
  return {
    id: "pref_1",
    locale: "en-US",
    unitSystem,
    dayStartTime: "00:00",
    timezone: "America/New_York",
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
