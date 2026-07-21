import { useAuth, useSessionList, useUser } from "@clerk/clerk-expo";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ActionButton, Card, InlineNotice, SectionHeader, StatusPill } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { signOutStoredSession } from "../../services/api";

type ManagedSession = {
  id: string;
  status?: string;
  lastActiveAt?: Date | null;
  expireAt?: Date | null;
  end?: () => Promise<unknown>;
};

export function ClerkAccountSecurity() {
  const { palette } = useTheme();
  const { sessionId } = useAuth();
  const { user } = useUser();
  const sessionList = useSessionList() as unknown as {
    isLoaded: boolean;
    sessions: ManagedSession[];
  };
  const [notice, setNotice] = useState<string | null>(null);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);

  async function endSession(session: ManagedSession) {
    if (!session.end) {
      setNotice("Clerk could not make this session available for revocation. Try again from your account security settings.");
      return;
    }

    setEndingSessionId(session.id);
    setNotice(null);
    try {
      await session.end();
      setNotice("That session was signed out.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "That session could not be signed out. Please try again.");
    } finally {
      setEndingSessionId(null);
    }
  }

  function confirmEndSession(session: ManagedSession) {
    Alert.alert(
      "Sign out this device?",
      "That device will need to sign in again before it can access your nutrition data.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out device", style: "destructive", onPress: () => void endSession(session) },
      ]
    );
  }

  return (
    <>
      <Card>
        <SectionHeader title="Account" meta="Clerk managed" />
        <Text style={[styles.name, { color: palette.ink }]}>{user?.fullName || user?.firstName || "Living Nutrition member"}</Text>
        <Text style={[styles.meta, { color: palette.muted }]}>{user?.primaryEmailAddress?.emailAddress || "Verified account"}</Text>
        <Text style={[styles.copy, { color: palette.muted }]}>
          Clerk manages sign-in, email verification, password recovery, and secure sessions. Living Nutrition only receives a verified account identifier to protect your saved meals and goals.
        </Text>
        <ActionButton label="Sign out" variant="secondary" onPress={() => void signOutStoredSession()} />
      </Card>

      <Card>
        <SectionHeader title="Active sessions" meta={sessionList.isLoaded ? `${sessionList.sessions.length} active` : "Loading..."} />
        <Text style={[styles.copy, { color: palette.muted }]}>
          Review other signed-in devices. Device labels are intentionally not collected by Living Nutrition.
        </Text>
        {notice ? <InlineNotice title="Session security" body={notice} tone="warning" /> : null}
        {sessionList.isLoaded && !sessionList.sessions.length ? (
          <Text style={[styles.meta, { color: palette.muted }]}>No active Clerk sessions were returned.</Text>
        ) : null}
        <View style={styles.sessions}>
          {sessionList.sessions.map((session) => {
            const current = session.id === sessionId;
            return (
              <View key={session.id} style={[styles.sessionRow, { borderColor: palette.border }]}>
                <View style={styles.sessionCopy}>
                  <View style={styles.sessionTitleRow}>
                    <Text style={[styles.sessionTitle, { color: palette.ink }]}>{current ? "This device" : "Another signed-in device"}</Text>
                    <StatusPill label={current ? "Current" : "Active"} tone="success" />
                  </View>
                  <Text style={[styles.meta, { color: palette.muted }]}>{formatActivity(session)}</Text>
                </View>
                {current ? null : (
                  <ActionButton
                    label={endingSessionId === session.id ? "Signing out..." : "Sign out"}
                    variant="danger"
                    disabled={endingSessionId !== null}
                    onPress={() => confirmEndSession(session)}
                  />
                )}
              </View>
            );
          })}
        </View>
      </Card>
    </>
  );
}

function formatActivity(session: ManagedSession) {
  if (session.lastActiveAt) return `Last active ${session.lastActiveAt.toLocaleString()}`;
  if (session.expireAt) return `Expires ${session.expireAt.toLocaleString()}`;
  return session.status ? `Status: ${session.status}` : "Managed by Clerk";
}

const styles = StyleSheet.create({
  name: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  meta: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  copy: { fontSize: 15, lineHeight: 22 },
  sessions: { gap: 12 },
  sessionRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, gap: 12 },
  sessionCopy: { gap: 4 },
  sessionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  sessionTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: "800" },
});
