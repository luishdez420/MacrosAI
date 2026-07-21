import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  ClerkAuthScreen,
  actionLabel,
  clerkErrorMessage,
  clerkIncompleteSignUpMessage,
} from "../ClerkAuthGate";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";

const mockSignIn = {
  create: jest.fn(),
  prepareFirstFactor: jest.fn(),
  attemptFirstFactor: jest.fn(),
  supportedFirstFactors: [
    { strategy: "password" },
    { strategy: "reset_password_email_code", emailAddressId: "idn_email_1" },
  ],
};
const mockSetActive = jest.fn();
const mockSignUp = {
  attemptEmailAddressVerification: jest.fn(),
  create: jest.fn(),
  emailAddress: null as string | null,
  firstName: null as string | null,
  lastName: null as string | null,
  legalAcceptedAt: null as number | null,
  missingFields: [] as string[],
  prepareEmailAddressVerification: jest.fn(),
  update: jest.fn(),
  username: null as string | null,
};

jest.mock("@clerk/clerk-expo", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: jest.fn(), signOut: jest.fn() }),
  useSignIn: () => ({ isLoaded: true, signIn: mockSignIn, setActive: mockSetActive }),
  useSignUp: () => ({ isLoaded: true, signUp: mockSignUp, setActive: mockSetActive }),
  useSSO: () => ({ startSSOFlow: jest.fn() }),
  useUser: () => ({ isLoaded: true, user: null }),
  useSessionList: () => ({ isLoaded: true, sessions: [] }),
}));

jest.mock("expo-linking", () => ({ createURL: jest.fn(() => "livingnutrition:///") }));

describe("ClerkAuthScreen", () => {
  beforeEach(() => {
    mockSignIn.create.mockReset();
    mockSignIn.prepareFirstFactor.mockReset();
    mockSignIn.attemptFirstFactor.mockReset();
    mockSignUp.attemptEmailAddressVerification.mockReset();
    mockSignUp.create.mockReset();
    mockSignUp.prepareEmailAddressVerification.mockReset();
    mockSignUp.update.mockReset();
    mockSetActive.mockReset();
    mockSignIn.create.mockResolvedValue(mockSignIn);
    mockSignIn.prepareFirstFactor.mockResolvedValue(mockSignIn);
    mockSignIn.attemptFirstFactor.mockResolvedValue({ createdSessionId: "sess_1" });
    mockSignUp.create.mockResolvedValue(mockSignUp);
    mockSignUp.prepareEmailAddressVerification.mockResolvedValue(mockSignUp);
    mockSignUp.attemptEmailAddressVerification.mockResolvedValue({ createdSessionId: "sess_sign_up" });
    mockSignUp.update.mockResolvedValue({ createdSessionId: "sess_sign_up" });
    mockSignUp.emailAddress = null;
    mockSignUp.firstName = null;
    mockSignUp.lastName = null;
    mockSignUp.legalAcceptedAt = null;
    mockSignUp.missingFields = [];
    mockSignUp.username = null;
    mockSetActive.mockResolvedValue(undefined);
  });

  it("uses Clerk's recovery-code flow without handling a local password reset", async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByText("Forgot password?"));
    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await waitFor(() => {
      expect(view.getByText("Send recovery code")).toBeTruthy();
    });
    await fireEvent.press(view.getByText("Send recovery code"));

    await waitFor(() => {
      expect(mockSignIn.create).toHaveBeenCalledWith({ identifier: "person@example.com" });
      expect(mockSignIn.prepareFirstFactor).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        emailAddressId: "idn_email_1",
      });
      expect(view.getByLabelText("Email verification or recovery code")).toBeTruthy();
    });

    await fireEvent.changeText(view.getByLabelText("Email verification or recovery code"), "123456");
    await fireEvent.changeText(view.getByLabelText("New password"), "a-safer-password");
    await waitFor(() => {
      expect(view.getByLabelText("Email verification or recovery code").props.value).toBe("123456");
      expect(view.getByLabelText("New password").props.value).toBe("a-safer-password");
    });
    await fireEvent.press(view.getByText("Reset password"));

    await waitFor(() => {
      expect(mockSignIn.attemptFirstFactor).toHaveBeenCalledWith({
        strategy: "reset_password_email_code",
        code: "123456",
        password: "a-safer-password",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "sess_1" });
    });
  });

  it("asks for a password only when Clerk does not advertise email-code sign-in", async () => {
    mockSignIn.create.mockResolvedValueOnce(mockSignIn);
    mockSignIn.attemptFirstFactor.mockResolvedValueOnce({ createdSessionId: "sess_sign_in" });
    const view = await renderScreen();

    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.press(view.getByText("Continue"));

    await waitFor(() => {
      expect(mockSignIn.create).toHaveBeenCalledWith({
        identifier: "person@example.com",
      });
      expect(view.getByLabelText("Password")).toBeTruthy();
    });

    await fireEvent.changeText(view.getByLabelText("Password"), "a-safer-password");
    await fireEvent.press(view.getByText("Sign in"));

    await waitFor(() => {
      expect(mockSignIn.attemptFirstFactor).toHaveBeenCalledWith({
        strategy: "password",
        password: "a-safer-password",
      });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "sess_sign_in" });
    });
  });

  it("uses Clerk's advertised email-code factor when password is unavailable", async () => {
    const identifierAttempt = {
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_email_1" }],
      prepareFirstFactor: jest.fn(),
    };
    const emailCodeAttempt = {
      attemptFirstFactor: jest.fn().mockResolvedValue({ createdSessionId: "sess_code" }),
    };
    identifierAttempt.prepareFirstFactor.mockResolvedValue(emailCodeAttempt);
    mockSignIn.create.mockResolvedValueOnce(identifierAttempt).mockResolvedValueOnce(identifierAttempt);
    const view = await renderScreen();

    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.press(view.getByText("Continue"));

    await waitFor(() => {
      expect(mockSignIn.attemptFirstFactor).not.toHaveBeenCalled();
      expect(mockSignIn.create).toHaveBeenLastCalledWith({
        identifier: "person@example.com",
      });
      expect(identifierAttempt.prepareFirstFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        emailAddressId: "idn_email_1",
      });
      expect(view.getByLabelText("Sign-in code")).toBeTruthy();
      expect(view.getByText("We sent a sign-in code to your email.")).toBeTruthy();
    });

    await fireEvent.changeText(view.getByLabelText("Sign-in code"), "123456");
    await fireEvent.press(view.getByText("Sign in with code"));

    await waitFor(() => {
      expect(emailCodeAttempt.attemptFirstFactor).toHaveBeenCalledWith({
        strategy: "email_code",
        code: "123456",
      });
    });
  });

  it("prefers password when Clerk advertises both password and email-code sign-in", async () => {
    const identifierAttempt = {
      supportedFirstFactors: [
        { strategy: "email_code", emailAddressId: "idn_email_1" },
        { strategy: "password" },
      ],
      prepareFirstFactor: jest.fn(),
    };
    mockSignIn.create.mockResolvedValueOnce(identifierAttempt);
    const view = await renderScreen();

    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.press(view.getByText("Continue"));

    await waitFor(() => {
      expect(identifierAttempt.prepareFirstFactor).not.toHaveBeenCalled();
      expect(view.getByLabelText("Password")).toBeTruthy();
      expect(view.getByText("Enter your password to finish signing in.")).toBeTruthy();
    });
  });

  it("requests a fresh advertised email-code attempt when a password-only attempt is rejected", async () => {
    const signInAttempt = {
      supportedFirstFactors: [{ strategy: "password" }],
      attemptFirstFactor: jest.fn().mockRejectedValue({
        errors: [{ code: "strategy_for_user_invalid" }],
      }),
    };
    const freshAttempt = {
      supportedFirstFactors: [{ strategy: "email_code", emailAddressId: "idn_email_1" }],
      prepareFirstFactor: jest.fn(),
    };
    const emailCodeAttempt = {
      attemptFirstFactor: jest.fn().mockResolvedValue({ createdSessionId: "sess_code" }),
    };
    freshAttempt.prepareFirstFactor.mockResolvedValue(emailCodeAttempt);
    mockSignIn.create.mockResolvedValueOnce(signInAttempt).mockResolvedValueOnce(freshAttempt);
    const view = await renderScreen();

    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.press(view.getByText("Continue"));

    await waitFor(() => {
      expect(view.getByLabelText("Password")).toBeTruthy();
    });
    await fireEvent.changeText(view.getByLabelText("Password"), "a-safer-password");
    await fireEvent.press(view.getByText("Sign in"));

    await waitFor(() => {
      expect(mockSignIn.create).toHaveBeenCalledTimes(2);
      expect(freshAttempt.prepareFirstFactor).toHaveBeenCalledWith({ strategy: "email_code", emailAddressId: "idn_email_1" });
      expect(view.getByLabelText("Sign-in code")).toBeTruthy();
    });
  });

  it("does not submit an email-first sign-in without an email address", async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByText("Continue"));

    expect(mockSignIn.create).not.toHaveBeenCalled();
  });

  it("completes Clerk-required profile fields after email verification instead of sending an unfinished account to sign in", async () => {
    mockSignUp.attemptEmailAddressVerification.mockResolvedValueOnce({
      missingFields: ["username", "legal_accepted"],
    });
    const view = await renderScreen();

    await fireEvent.press(view.getByText("Create an account"));
    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.changeText(view.getByLabelText("Password"), "a-safer-password");
    await fireEvent.press(view.getByText("Send verification code"));

    await waitFor(() => {
      expect(view.getByLabelText("Email verification or recovery code")).toBeTruthy();
    });
    await fireEvent.changeText(view.getByLabelText("Email verification or recovery code"), "123456");
    await fireEvent.press(view.getByText("Verify email"));

    await waitFor(() => {
      expect(view.getByLabelText("Username")).toBeTruthy();
      expect(view.getByLabelText("Accept legal terms")).toBeTruthy();
      expect(view.getByText("Complete account")).toBeTruthy();
    });

    await fireEvent.changeText(view.getByLabelText("Username"), "living-user");
    await fireEvent.press(view.getByLabelText("Accept legal terms"));
    await fireEvent.press(view.getByText("Complete account"));

    await waitFor(() => {
      expect(mockSignUp.update).toHaveBeenCalledWith({ username: "living-user", legalAccepted: true });
      expect(mockSetActive).toHaveBeenCalledWith({ session: "sess_sign_up" });
    });
  });

  it("resumes a verified but incomplete sign-up when the user returns to sign in", async () => {
    mockSignUp.attemptEmailAddressVerification.mockResolvedValueOnce({
      missingFields: ["username"],
    });
    const view = await renderScreen();

    await fireEvent.press(view.getByText("Create an account"));
    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.changeText(view.getByLabelText("Password"), "a-safer-password");
    await fireEvent.press(view.getByText("Send verification code"));
    await waitFor(() => expect(view.getByLabelText("Email verification or recovery code")).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText("Email verification or recovery code"), "123456");
    await fireEvent.press(view.getByText("Verify email"));
    await waitFor(() => expect(view.getByLabelText("Username")).toBeTruthy());

    await fireEvent.press(view.getByText("Back to sign in"));
    await fireEvent.changeText(view.getByLabelText("Email address"), "person@example.com");
    await fireEvent.press(view.getByText("Continue"));

    await waitFor(() => {
      expect(mockSignIn.create).not.toHaveBeenCalled();
      expect(view.getByLabelText("Username")).toBeTruthy();
      expect(view.getAllByText(/Your email is verified/).length).toBeGreaterThan(0);
    });
  });

  it("keeps labels and Clerk errors readable", () => {
    expect(actionLabel("recover_request")).toBe("Send recovery code");
    expect(actionLabel("complete_sign_up")).toBe("Complete account");
    expect(clerkErrorMessage({ errors: [{ longMessage: "Use a valid code." }] })).toBe("Use a valid code.");
    expect(clerkErrorMessage({ errors: [{ message: "Verification strategy password is not valid for this account." }] })).toContain(
      "cannot use the selected verification method"
    );
    expect(clerkErrorMessage(new Error("Strategy password is not valid for this account."))).toContain(
      "cannot use the selected verification method"
    );
    expect(clerkErrorMessage({ errors: [{ code: "strategy_for_user_invalid" }] })).toContain(
      "cannot use the selected verification method"
    );
    expect(clerkIncompleteSignUpMessage({ missingFields: ["username", "legal_accepted"] })).toContain(
      "a username, acceptance of the legal terms"
    );
  });
});

async function renderScreen() {
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <ThemeProvider initialPreference="dark">
        <ClerkAuthScreen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
