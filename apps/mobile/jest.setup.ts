// React 19 expects test environments with stateful component tests to opt into act().
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Unit tests exercise reminder state, not Expo Go's native notification bridge.
jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { CALENDAR: "calendar", DAILY: "daily" },
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  scheduleNotificationAsync: jest.fn(async () => "notification_test_1"),
  setNotificationHandler: jest.fn(),
}));

jest.mock("@clerk/clerk-expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    sessionId: null,
    getToken: jest.fn(async () => null),
    signOut: jest.fn(async () => undefined),
  }),
  useSignIn: () => ({ isLoaded: true, signIn: {}, setActive: jest.fn(async () => undefined) }),
  useSignUp: () => ({ isLoaded: true, signUp: {}, setActive: jest.fn(async () => undefined) }),
  useSSO: () => ({ startSSOFlow: jest.fn(async () => ({ createdSessionId: null })) }),
  useUser: () => ({ isLoaded: true, user: null }),
  useSessionList: () => ({ isLoaded: true, sessions: [] }),
}));

jest.mock("@clerk/clerk-expo/token-cache", () => ({ tokenCache: undefined }));

jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
  init: jest.fn(),
  withScope: (callback: (scope: { setTag: jest.Mock }) => void) =>
    callback({ setTag: jest.fn() }),
  wrap: <T,>(component: T) => component,
}));
