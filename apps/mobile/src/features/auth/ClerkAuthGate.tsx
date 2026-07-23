import { ClerkProvider, useAuth, useSignIn, useSignUp, useSSO, useUser } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { env } from "../../config/env";
import { api, configureManagedAuth, signOutStoredSession } from "../../services/api";
import { ActionButton, Card, InlineNotice, ScreenShell, SectionHeader } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

export function ManagedAuthProvider({ children }: PropsWithChildren) {
  if (!env.clerkPublishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
      <ClerkApiBridge>{children}</ClerkApiBridge>
    </ClerkProvider>
  );
}

export function ClerkApiBridge({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { getToken, isLoaded, signOut, userId } = useAuth();
  const accountScope = isLoaded ? userId ?? null : undefined;
  const [readyAccountScope, setReadyAccountScope] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    configureManagedAuth({ getToken, getUserId: () => userId ?? null, signOut });
    return () => configureManagedAuth(undefined);
  }, [getToken, signOut, userId]);

  useEffect(() => {
    if (accountScope === undefined || readyAccountScope === accountScope) {
      return;
    }

    // Query keys intentionally describe resources rather than identities. Never
    // let cached account data render while Clerk changes the active user.
    queryClient.clear();
    setReadyAccountScope(accountScope);
  }, [accountScope, queryClient, readyAccountScope]);

  if (accountScope === undefined || readyAccountScope !== accountScope) {
    return <AuthLoadingScreen />;
  }

  return <ClerkAccessGate>{children}</ClerkAccessGate>;
}

function ClerkAccessGate({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <AuthLoadingScreen />;
  }

  if (!isSignedIn) {
    return <ClerkAuthScreen />;
  }

  return <ClerkProfileGate>{children}</ClerkProfileGate>;
}

function ClerkProfileGate({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { isLoaded, user } = useUser();
  const profile = useQuery({
    queryKey: ["session"],
    queryFn: () => api.getSession(),
    retry: false,
  });

  if (!isLoaded || profile.isLoading) {
    return <AuthLoadingScreen />;
  }

  if (profile.data) {
    return <>{children}</>;
  }

  const needsSetup =
    profile.error instanceof Error &&
    "status" in profile.error &&
    profile.error.status === 401 &&
    profile.error.message.includes("Set up your Living Nutrition profile");

  if (!needsSetup) {
    return <AuthProfileErrorScreen error={profile.error instanceof Error ? profile.error.message : "Your profile could not load."} onRetry={() => void profile.refetch()} />;
  }

  return (
    <ClerkProfileSetupScreen
      email={user?.primaryEmailAddress?.emailAddress ?? undefined}
      displayName={user?.fullName ?? user?.firstName ?? undefined}
      error={profile.error instanceof Error ? profile.error.message : undefined}
      onComplete={async () => {
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        await queryClient.invalidateQueries({ queryKey: ["preferences"] });
        await queryClient.invalidateQueries({ queryKey: ["diary"] });
      }}
    />
  );
}

function AuthProfileErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <ScreenShell contentStyle={styles.authContent}>
      <Text style={styles.kicker}>ACCOUNT CONNECTION</Text>
      <Text style={styles.authTitle}>Your profile is not available yet</Text>
      <Text style={styles.authBody}>We could not confirm your Living Nutrition profile. Check your connection and try again. {error}</Text>
      <Card style={styles.authCard}>
        <ActionButton label="Try again" onPress={onRetry} />
        <ActionButton label="Sign out" variant="secondary" onPress={() => void signOutStoredSession()} />
      </Card>
    </ScreenShell>
  );
}

function AuthLoadingScreen() {
  return (
    <ScreenShell contentStyle={styles.centered}>
      <Text style={styles.kicker}>LIVING NUTRITION</Text>
      <Text style={styles.loadingTitle}>Preparing your private nutrition space</Text>
      <Text style={styles.loadingBody}>Checking your secure session. No meal data is loaded until this is ready.</Text>
    </ScreenShell>
  );
}

type AuthMode =
  | "sign_in"
  | "sign_in_password"
  | "sign_in_code"
  | "sign_up"
  | "verify"
  | "complete_sign_up"
  | "recover_request"
  | "recover_reset";

export function ClerkAuthScreen() {
  const { palette } = useTheme();
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const { startSSOFlow } = useSSO();
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [requiredSignUpFields, setRequiredSignUpFields] = useState<string[]>([]);
  const [pendingSignUpEmail, setPendingSignUpEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Recovery uses the specific resource that prepared its email-code factor.
  // Password sign-in is intentionally a one-step Clerk request below.
  const activeSignInAttempt = useRef<NonNullable<typeof signIn> | null>(null);

  async function prepareEmailCodeSignIn(attempt: NonNullable<typeof signIn>) {
    const emailCodeFactor = (attempt.supportedFirstFactors ?? []).find(
      (factor) => factor.strategy === "email_code"
    );
    if (!emailCodeFactor || !("emailAddressId" in emailCodeFactor)) {
      return false;
    }
    const preparedAttempt = await attempt.prepareFirstFactor({
      strategy: "email_code",
      emailAddressId: emailCodeFactor.emailAddressId,
    });
    activeSignInAttempt.current = preparedAttempt;
    setVerificationCode("");
    setMode("sign_in_code");
    setNotice("We sent a sign-in code to your email.");
    return true;
  }

  async function startEmailCodeSignIn({ forceFresh = false }: { forceFresh?: boolean } = {}) {
    if (!signIn) {
      throw new Error("Clerk is still preparing sign-in. Please try again in a moment.");
    }

    // Never reuse an attempt after Clerk has rejected a strategy. Its advertised
    // factors can no longer be trusted for a follow-up verification request.
    if (!forceFresh && activeSignInAttempt.current) {
      try {
        if (await prepareEmailCodeSignIn(activeSignInAttempt.current)) {
          return true;
        }
      } catch {
        // Start a clean attempt below rather than leaving the user on an error
        // notice if Clerk invalidates this attempt while preparing the factor.
      }
    }

    const freshAttempt = await signIn.create({ identifier: email.trim() });
    activeSignInAttempt.current = freshAttempt;
    return prepareEmailCodeSignIn(freshAttempt);
  }

  const title = useMemo(() => {
    if (mode === "sign_up") return "Create your account";
    if (mode === "sign_in_code") return "Check your email";
    if (mode === "verify") return "Check your email";
    if (mode === "complete_sign_up") return "Finish creating your account";
    if (mode === "recover_request") return "Reset your password";
    if (mode === "recover_reset") return "Choose a new password";
    return "Welcome back";
  }, [mode]);

  async function submit() {
    if (!signInLoaded || !signUpLoaded) return;
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "sign_in") {
        // A verified email does not create an account until Clerk's required
        // profile fields are completed. Keep that person in the same sign-up
        // attempt instead of sending an unsupported sign-in strategy.
        if (hasPendingSignUpForEmail(signUp, email, pendingSignUpEmail, requiredSignUpFields)) {
          showIncompleteSignUp(signUp);
          return;
        }

        // Ask Clerk which factors this exact identifier supports. For a normal
        // email/password account, use password first. Email codes remain a
        // fallback only when the account does not advertise password.
        const signInAttempt = await signIn.create({ identifier: email.trim() });
        activeSignInAttempt.current = signInAttempt;
        const supportsPassword = (signInAttempt.supportedFirstFactors ?? []).some(
          (factor) => factor.strategy === "password"
        );
        if (supportsPassword) {
          setPassword("");
          setMode("sign_in_password");
          setNotice("Enter your password to finish signing in.");
          return;
        }

        if (await prepareEmailCodeSignIn(signInAttempt)) {
          return;
        }

        setNotice(
          "Clerk did not offer a supported email sign-in method for this account. Choose Continue with Google if you created it with Google, or check the enabled sign-in methods in Clerk."
        );
        return;
      }

      if (mode === "sign_in_password") {
        const signInAttempt = activeSignInAttempt.current ?? (await signIn.create({ identifier: email.trim() }));
        activeSignInAttempt.current = signInAttempt;
        const supportsPassword = (signInAttempt.supportedFirstFactors ?? []).some(
          (factor) => factor.strategy === "password"
        );
        if (!supportsPassword) {
          if (await startEmailCodeSignIn()) {
            return;
          }
          setNotice(
            "This sign-in attempt no longer supports password. We could not start an email-code alternative either. Choose Continue with Google if you created the account with Google, or check your Clerk sign-in settings."
          );
          return;
        }

        const result = await signInAttempt.attemptFirstFactor({
          strategy: "password",
          password,
        });
        if (result.createdSessionId) {
          await setSignInActive({ session: result.createdSessionId });
        } else {
          setNotice(
            "Clerk did not complete this sign-in. If this account uses Google, choose Continue with Google. Otherwise confirm Password is enabled for email sign-in in Clerk."
          );
        }
        return;
      }

      if (mode === "sign_in_code") {
        const signInAttempt = activeSignInAttempt.current;
        if (!signInAttempt) {
          setMode("sign_in");
          setVerificationCode("");
          throw new Error("Your sign-in code expired. Start sign-in again to request a fresh code.");
        }
        const result = await signInAttempt.attemptFirstFactor({
          strategy: "email_code",
          code: verificationCode.trim(),
        });
        if (result.createdSessionId) {
          await setSignInActive({ session: result.createdSessionId });
        } else {
          setNotice("Clerk did not complete this sign-in. Request a new code or choose another configured sign-in method.");
        }
        return;
      }

      if (mode === "sign_up") {
        await signUp.create({ emailAddress: email.trim(), password });
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setMode("verify");
        setNotice("We sent a verification code to your email.");
        return;
      }

      if (mode === "verify") {
        const result = await signUp.attemptEmailAddressVerification({ code: verificationCode.trim() });
        if (result.createdSessionId) {
          await setSignUpActive({ session: result.createdSessionId });
        } else {
          showIncompleteSignUp(result);
        }
        return;
      }

      if (mode === "complete_sign_up") {
        const supportedFields = new Set(requiredSignUpFields);
        const update: Record<string, string | boolean> = {};

        if (supportedFields.has("username")) update.username = username.trim();
        if (supportedFields.has("first_name")) update.firstName = firstName.trim();
        if (supportedFields.has("last_name")) update.lastName = lastName.trim();
        if (supportedFields.has("legal_accepted")) update.legalAccepted = legalAccepted;

        const unsupportedFields = requiredSignUpFields.filter(
          (field) => !["username", "first_name", "last_name", "legal_accepted"].includes(field)
        );
        if (unsupportedFields.length) {
          setNotice(
            `This Clerk tenant requires ${unsupportedFields.map(humanizeClerkField).join(", ")}, which this mobile flow cannot safely collect yet. Update the required sign-up fields in Clerk, then restart account creation.`
          );
          return;
        }

        const result = await signUp.update(update);
        if (result.createdSessionId) {
          await setSignUpActive({ session: result.createdSessionId });
          return;
        }

        showIncompleteSignUp(result);
        return;
      }

      if (mode === "recover_request") {
        const resetSignIn = await signIn.create({ identifier: email.trim() });
        activeSignInAttempt.current = resetSignIn;
        const resetFactor = (resetSignIn.supportedFirstFactors ?? []).find(
          (factor) => factor.strategy === "reset_password_email_code"
        );
        if (!resetFactor || !("emailAddressId" in resetFactor)) {
          throw new Error("Password recovery is not enabled for this account. Use the sign-in options configured in Clerk.");
        }
        const preparedAttempt = await resetSignIn.prepareFirstFactor({
          strategy: "reset_password_email_code",
          emailAddressId: resetFactor.emailAddressId,
        });
        activeSignInAttempt.current = preparedAttempt;
        setMode("recover_reset");
        setNotice("We sent a recovery code to your email.");
        return;
      }

      const signInAttempt = activeSignInAttempt.current;
      if (!signInAttempt) {
        setMode("sign_in");
        setVerificationCode("");
        throw new Error("Your recovery code expired. Start password recovery again to request a fresh code.");
      }
      const result = await signInAttempt.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: verificationCode.trim(),
        password,
      });
      if (result.createdSessionId) {
        await setSignInActive({ session: result.createdSessionId });
      } else {
        setNotice("Your password was updated, but this account still needs a Clerk setup step.");
      }
    } catch (error) {
      if ((mode === "sign_in" || mode === "sign_in_password") && isInvalidVerificationStrategyError(error)) {
        // Clerk can reject a sign-in factor when this client still holds a
        // just-verified, incomplete sign-up. Resume that sign-up rather than
        // asking the account to verify with a factor it cannot use yet.
        if (hasPendingSignUpForEmail(signUp, email, pendingSignUpEmail, requiredSignUpFields)) {
          activeSignInAttempt.current = null;
          setPassword("");
          showIncompleteSignUp(signUp);
          return;
        }

        activeSignInAttempt.current = null;
        setPassword("");
        try {
          if (await startEmailCodeSignIn({ forceFresh: true })) {
            return;
          }
        } catch (fallbackError) {
          activeSignInAttempt.current = null;
          setMode("sign_in");
          setNotice(
            "Clerk could not start a supported sign-in method for this account. Confirm Email address and Password are enabled in Clerk, then start sign-in again."
          );
          return;
        }

        activeSignInAttempt.current = null;
        setMode("sign_in");
        setNotice(
          "Clerk did not offer a supported sign-in method for this account. Confirm Email address and Password are enabled in Clerk, or use the Google method linked to this account."
        );
        return;
      }

      if (mode === "sign_in_code" && isInvalidVerificationStrategyError(error)) {
        activeSignInAttempt.current = null;
        setVerificationCode("");
        setMode("sign_in");
        setNotice(
          "That sign-in code cannot be used for this attempt. Start again so Clerk can offer the methods valid for this account."
        );
        return;
      }
      setNotice(clerkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setNotice(null);
    setBusy(true);
    try {
      const result = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: Linking.createURL("/"),
      });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
      } else {
        setNotice("Google sign-in was not completed. You can use email and password instead.");
      }
    } catch (error) {
      setNotice(clerkErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const needsCode = mode === "sign_in_code" || mode === "verify" || mode === "recover_reset";
  const needsPassword = mode === "sign_in_password" || mode === "sign_up" || mode === "recover_reset";
  const needsIdentifier = mode === "sign_in" || mode === "sign_up" || mode === "recover_request";
  const needsUsername = mode === "complete_sign_up" && requiredSignUpFields.includes("username");
  const needsFirstName = mode === "complete_sign_up" && requiredSignUpFields.includes("first_name");
  const needsLastName = mode === "complete_sign_up" && requiredSignUpFields.includes("last_name");
  const needsLegalAcceptance = mode === "complete_sign_up" && requiredSignUpFields.includes("legal_accepted");
  const canSubmit =
    mode === "complete_sign_up"
      ? (!needsUsername || Boolean(username.trim())) &&
        (!needsFirstName || Boolean(firstName.trim())) &&
        (!needsLastName || Boolean(lastName.trim())) &&
        (!needsLegalAcceptance || legalAccepted)
      : (needsCode ? Boolean(verificationCode.trim()) : mode === "sign_in_password" ? true : Boolean(email.trim())) &&
        (!needsPassword || Boolean(password));

  return (
    <ScreenShell contentStyle={styles.authContent}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Text style={styles.kicker}>LIVING NUTRITION</Text>
        <Text style={styles.authTitle}>{title}</Text>
        <Text style={styles.authBody}>
          Secure sign-in, email verification, and recovery are managed by Clerk. Your nutrition records remain private to your account.
        </Text>
        <Card style={styles.authCard}>
          {needsIdentifier ? (
            <>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Email</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={palette.muted}
                style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                value={email}
              />
            </>
          ) : null}
          {needsCode ? (
            <>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Email code</Text>
              <TextInput
                accessibilityLabel={mode === "sign_in_code" ? "Sign-in code" : "Email verification or recovery code"}
                autoCapitalize="none"
                keyboardType="number-pad"
                onChangeText={setVerificationCode}
                placeholder={mode === "sign_in_code" ? "Enter the sign-in code" : "Enter the code"}
                placeholderTextColor={palette.muted}
                style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                value={verificationCode}
              />
            </>
          ) : null}
          {needsPassword ? (
            <>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Password</Text>
              <TextInput
                accessibilityLabel={mode === "recover_reset" ? "New password" : "Password"}
                autoComplete={mode === "sign_up" || mode === "recover_reset" ? "new-password" : "current-password"}
                onChangeText={setPassword}
                placeholder={mode === "recover_reset" ? "New password" : "Password"}
                placeholderTextColor={palette.muted}
                secureTextEntry
                style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                value={password}
              />
            </>
          ) : null}
          {mode === "complete_sign_up" ? (
            <>
              <InlineNotice
                tone="warning"
                title="One last Clerk step"
                body="Your email is verified. Complete the fields required by this account before signing in."
              />
              {needsUsername ? (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Username</Text>
                  <TextInput
                    accessibilityLabel="Username"
                    autoCapitalize="none"
                    autoComplete="username"
                    onChangeText={setUsername}
                    placeholder="Choose a username"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                    value={username}
                  />
                </>
              ) : null}
              {needsFirstName ? (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>First name</Text>
                  <TextInput
                    accessibilityLabel="First name"
                    autoComplete="given-name"
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                    value={firstName}
                  />
                </>
              ) : null}
              {needsLastName ? (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Last name</Text>
                  <TextInput
                    accessibilityLabel="Last name"
                    autoComplete="family-name"
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
                    value={lastName}
                  />
                </>
              ) : null}
              {needsLegalAcceptance ? (
                <Pressable
                  accessibilityLabel="Accept legal terms"
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: legalAccepted }}
                  onPress={() => setLegalAccepted((current) => !current)}
                  style={[styles.legalAcceptance, { borderColor: palette.border, backgroundColor: palette.controlSurface }]}
                >
                  <View style={[styles.checkbox, { borderColor: palette.muted, backgroundColor: legalAccepted ? palette.actionText : "transparent" }]}>
                    {legalAccepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                  <Text style={[styles.legalAcceptanceText, { color: palette.ink }]}>I accept the legal terms configured for this Clerk account.</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {notice ? (
            <View style={styles.authNotice}>
              <InlineNotice tone="warning" title="Account action" body={notice} />
            </View>
          ) : null}
          <View style={styles.primaryActions}>
            <ActionButton
              disabled={busy || !canSubmit}
              label={busy ? "Working..." : actionLabel(mode)}
              loading={busy}
              onPress={() => void submit()}
            />
            {mode === "sign_in" || mode === "sign_up" ? (
              <ActionButton
                disabled={busy}
                label="Continue with Google"
                variant="secondary"
                onPress={() => void signInWithGoogle()}
              />
            ) : null}
          </View>
          <View style={styles.authLinks}>
            {mode === "sign_in" ? (
              <>
                <ActionButton label="Create an account" variant="quiet" onPress={() => changeMode("sign_up")} />
                <ActionButton label="Forgot password?" variant="quiet" onPress={() => changeMode("recover_request")} />
              </>
            ) : (
              <ActionButton label="Back to sign in" variant="quiet" onPress={() => changeMode("sign_in")} />
            )}
          </View>
        </Card>
      </KeyboardAvoidingView>
    </ScreenShell>
  );

  function changeMode(nextMode: AuthMode) {
    activeSignInAttempt.current = null;
    setVerificationCode("");
    setNotice(null);
    setMode(nextMode);
  }

  function showIncompleteSignUp(result: ClerkIncompleteSignUp) {
    // A Clerk hook can lag behind the verification result for one render.
    // Retain the fields we already received instead of replacing them with an
    // empty array when a user returns to sign in during that transition.
    const resultFields = normalizeSignUpFields(result.missingFields);
    const missingFields = resultFields.length ? resultFields : requiredSignUpFields;
    setRequiredSignUpFields(missingFields);
    setPendingSignUpEmail(signUp?.emailAddress ?? (email.trim() || null));
    setUsername(signUp?.username ?? "");
    setFirstName(signUp?.firstName ?? "");
    setLastName(signUp?.lastName ?? "");
    setLegalAccepted(Boolean(signUp?.legalAcceptedAt));
    setVerificationCode("");
    setMode("complete_sign_up");
    setNotice(clerkIncompleteSignUpMessage({ missingFields }));
  }
}

function ClerkProfileSetupScreen({
  email,
  displayName,
  error,
  onComplete,
}: {
  email?: string;
  displayName?: string;
  error?: string;
  onComplete: () => Promise<void>;
}) {
  const { palette } = useTheme();
  const [migrating, setMigrating] = useState(false);
  const [legacyEmail, setLegacyEmail] = useState(email ?? "");
  const [legacyPassword, setLegacyPassword] = useState("");
  const [notice, setNotice] = useState(error ?? null);
  const [busy, setBusy] = useState(false);

  async function completeNewProfile() {
    setBusy(true);
    setNotice(null);
    try {
      await api.provisionClerkProfile({ email: email ?? null, displayName: displayName ?? null });
      await onComplete();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "We could not set up your profile. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function migrate() {
    setBusy(true);
    setNotice(null);
    try {
      await api.migrateLocalAccount({ email: legacyEmail.trim(), password: legacyPassword });
      await onComplete();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "We could not move your local account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenShell contentStyle={styles.authContent}>
      <Text style={styles.kicker}>ACCOUNT SETUP</Text>
      <Text style={styles.authTitle}>{migrating ? "Move your existing data" : "Choose your profile"}</Text>
      <Text style={styles.authBody}>
        {migrating
          ? "Confirm the password for your previous Living Nutrition account. We will revoke its local sessions and link its saved meals to this Clerk account."
          : "Start a new Living Nutrition profile, or securely move data from a previous local account."}
      </Text>
      <Card style={styles.authCard}>
        {migrating ? (
          <>
            <Text style={[styles.fieldLabel, { color: palette.ink }]}>Previous account email</Text>
            <TextInput
              accessibilityLabel="Previous Living Nutrition account email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onChangeText={setLegacyEmail}
              placeholder="you@example.com"
              placeholderTextColor={palette.muted}
              style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
              value={legacyEmail}
            />
            <Text style={[styles.fieldLabel, { color: palette.ink }]}>Previous account password</Text>
            <TextInput
              accessibilityLabel="Previous Living Nutrition account password"
              autoComplete="current-password"
              onChangeText={setLegacyPassword}
              placeholder="Password"
              placeholderTextColor={palette.muted}
              secureTextEntry
              style={[styles.input, { color: palette.ink, backgroundColor: palette.controlSurface }]}
              value={legacyPassword}
            />
          </>
        ) : null}
        {notice ? <InlineNotice tone="warning" title="Profile setup" body={notice} /> : null}
        <ActionButton
          disabled={busy || (migrating && (!legacyEmail.trim() || !legacyPassword))}
          label={busy ? "Working..." : migrating ? "Move my account" : "Start a new profile"}
          loading={busy}
          onPress={() => void (migrating ? migrate() : completeNewProfile())}
          style={styles.authAction}
        />
        <ActionButton
          label={migrating ? "Start a new profile instead" : "Move an existing local account"}
          variant="secondary"
          onPress={() => {
            setMigrating((current) => !current);
            setNotice(null);
          }}
        />
      </Card>
    </ScreenShell>
  );
}

export function actionLabel(mode: AuthMode) {
  if (mode === "sign_in_code") return "Sign in with code";
  if (mode === "sign_in_password") return "Sign in";
  if (mode === "sign_up") return "Send verification code";
  if (mode === "verify") return "Verify email";
  if (mode === "complete_sign_up") return "Complete account";
  if (mode === "recover_request") return "Send recovery code";
  if (mode === "recover_reset") return "Reset password";
  return "Continue";
}

export function clerkErrorMessage(error: unknown) {
  if (isInvalidVerificationStrategyError(error)) {
    return "Clerk cannot use the selected verification method for this account. Start sign-in again so it can offer a valid method, or finish any incomplete account-setup fields first.";
  }

  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    const first = errors?.[0];
    if (first?.longMessage || first?.message) {
      const message = first.longMessage ?? first.message ?? "Account action failed.";
      return message;
    }
  }
  return error instanceof Error ? error.message : "Account action failed. Please try again.";
}

function isInvalidVerificationStrategyError(error: unknown) {
  if (clerkErrorCode(error) === "strategy_for_user_invalid" || clerkErrorCode(error) === "verification_strategy_invalid") {
    return true;
  }

  const message = clerkErrorText(error);
  return /(?:verification\s+)?strategy\b.*(?:not\s+(?:valid|supported)|invalid)|(?:invalid|unsupported)\s+(?:verification\s+)?strategy/i.test(
    message
  );
}

function clerkErrorText(error: unknown) {
  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    const first = errors?.[0];
    return first?.longMessage ?? first?.message ?? "";
  }

  return error instanceof Error ? error.message : "";
}

function clerkErrorCode(error: unknown) {
  if (typeof error !== "object" || !error) return "";

  if ("errors" in error) {
    const errors = (error as { errors?: Array<{ code?: string }> }).errors;
    return errors?.[0]?.code ?? "";
  }

  return "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
}

type ClerkIncompleteSignUp = {
  missingFields?: string[] | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  legalAcceptedAt?: number | null;
};

function normalizeSignUpFields(fields: string[] | null | undefined) {
  return fields?.filter((field): field is string => typeof field === "string") ?? [];
}

function hasPendingSignUpForEmail(
  signUp: { emailAddress?: string | null; missingFields?: string[] | null } | null | undefined,
  email: string,
  pendingSignUpEmail?: string | null,
  pendingFields: string[] = []
) {
  const normalizedEmail = email.trim().toLowerCase();
  const clerkEmail = signUp?.emailAddress?.toLowerCase();
  const rememberedEmail = pendingSignUpEmail?.toLowerCase();
  const hasMissingFields = normalizeSignUpFields(signUp?.missingFields).length || pendingFields.length;

  return Boolean(normalizedEmail && hasMissingFields && (clerkEmail === normalizedEmail || rememberedEmail === normalizedEmail));
}

export function clerkIncompleteSignUpMessage(result: ClerkIncompleteSignUp) {
  const missingFields = normalizeSignUpFields(result.missingFields);

  if (missingFields.length) {
    return `Your email is verified. Clerk still requires: ${missingFields.map(humanizeClerkField).join(", ")}. Complete that requirement, or update Clerk's User & authentication settings if accounts should use email and password only.`;
  }

  return "Your email is verified, but Clerk did not create a session. Complete any required account fields, or confirm that email, password, and email verification code are enabled in Clerk.";
}

function humanizeClerkField(field: string) {
  const labels: Record<string, string> = {
    first_name: "a first name",
    last_name: "a last name",
    legal_accepted: "acceptance of the legal terms",
    phone_number: "a phone number",
    username: "a username",
  };

  return labels[field] ?? field.replace(/_/g, " ");
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: "center", paddingBottom: 140 },
  authContent: { flexGrow: 1, justifyContent: "center", paddingBottom: 140 },
  kicker: { fontSize: 13, fontWeight: "800", letterSpacing: 2.4, color: "#78AB57", marginBottom: 12 },
  loadingTitle: { fontSize: 32, lineHeight: 39, fontWeight: "800", color: "#EFF5EB", maxWidth: 560 },
  loadingBody: { marginTop: 14, fontSize: 17, lineHeight: 25, color: "#B7C6BA", maxWidth: 520 },
  authTitle: { fontSize: 39, lineHeight: 45, fontWeight: "800", color: "#EFF5EB", letterSpacing: -1.1 },
  authBody: { marginTop: 14, fontSize: 17, lineHeight: 25, color: "#B7C6BA", maxWidth: 560 },
  authCard: { marginTop: 36, gap: 12 },
  fieldLabel: { fontSize: 15, fontWeight: "700", marginTop: 4 },
  input: { minHeight: 52, borderRadius: 18, paddingHorizontal: 16, fontSize: 17 },
  authNotice: { marginTop: 10, marginBottom: 4 },
  authAction: { marginTop: 8 },
  primaryActions: { marginTop: 10, gap: 14 },
  authLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 8 },
  legalAcceptance: { minHeight: 48, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  legalAcceptanceText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkboxMark: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", lineHeight: 18 },
});
