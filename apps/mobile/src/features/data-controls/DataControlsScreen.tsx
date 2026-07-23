import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import type { SecurityActivity, UserDataExport } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { api, clearStoredSession, getStoredUserId } from "../../services/api";
import { clearQueuedMeals } from "../../services/offlineMealQueue";
import { shareUserDataExport } from "../../services/userDataExportFile";
import {
  ActionButton,
  Card,
  InlineNotice,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";
import { presentApiError } from "../../shared/domain/apiErrorPresentation";
import { useTheme } from "../../shared/theme/ThemeProvider";

type Notice = {
  title: string;
  body: string;
  tone: "success" | "warning" | "danger";
};

export function DataControlsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const [retentionDays, setRetentionDays] = useState("30");
  const retentionDaysRef = useRef(retentionDays);
  const serverRetentionDaysRef = useRef<string | null>(null);
  const retentionWasEditedRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exportData, setExportData] = useState<UserDataExport | null>(null);
  const [shareAcknowledged, setShareAcknowledged] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    retry: 1,
  });
  const securityActivity = useQuery({
    queryKey: ["security-activity"],
    queryFn: () => api.listSecurityActivity(),
    retry: 1,
  });

  const retentionMutation = useMutation({
    mutationFn: (days: number) => api.updatePreferences({ imageRetentionDays: days }),
    onSuccess: async (updatedPreferences) => {
      const updatedRetentionDays = String(updatedPreferences.imageRetentionDays);
      serverRetentionDaysRef.current = updatedRetentionDays;
      retentionWasEditedRef.current = false;
      updateRetentionDays(updatedRetentionDays);
      queryClient.setQueryData(["preferences"], updatedPreferences);
      setNotice({
        title: "Retention preference saved",
        body: retentionSummary(updatedPreferences.imageRetentionDays),
        tone: "success",
      });
      await queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (error) => {
      setNotice({
        title: "Retention preference was not saved",
        body: presentApiError(error, "We couldn't save that preference right now. Try again in a moment.").body,
        tone: "warning",
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => api.exportUserData(),
    onSuccess: (result) => {
      setExportData(result);
      setShareAcknowledged(false);
      setNotice({
        title: "JSON export prepared",
        body: "This is a reviewable versioned snapshot from the current account and API session. Review the recipient guidance before opening the system share sheet; the temporary file is removed from the app cache afterward.",
        tone: "success",
      });
    },
    onError: (error) => {
      setNotice({
        title: "Data export was not prepared",
        body: presentApiError(error, "We couldn't prepare your data export right now. Try again in a moment.").body,
        tone: "danger",
      });
    },
  });

  const shareExportMutation = useMutation({
    mutationFn: async () => {
      if (!exportData) {
        throw new Error("Prepare a JSON export before sharing it.");
      }
      return shareUserDataExport(exportData);
    },
    onSuccess: (result) => {
      if (result.status === "unavailable") {
        setNotice({
          title: "File sharing is unavailable",
          body: "This runtime cannot open the system share sheet. No temporary export file was retained in the app cache.",
          tone: "warning",
        });
        return;
      }

      setNotice({
        title: "Export shared",
        body: "The system share sheet finished. The temporary JSON export file was removed from the app cache.",
        tone: "success",
      });
    },
    onError: () => {
      setNotice({
        title: "Export file was not shared",
        body: "We couldn't open the system share sheet. No temporary export file was retained in the app cache. Try again on this device.",
        tone: "warning",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      const ownerId = await getStoredUserId();
      if (ownerId) {
        await clearQueuedMeals(ownerId).catch(() => undefined);
      }
      await clearStoredSession();
      queryClient.clear();
      router.replace("/");
    },
    onError: (error) => {
      setNotice({
        title: "Local account was not deleted",
        body: presentApiError(error, "We couldn't delete this local account right now. Try again in a moment.").body,
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    if (!preferences.data || retentionMutation.isPending || retentionWasEditedRef.current) {
      return;
    }

    const loadedRetentionDays = String(preferences.data.imageRetentionDays);

    if (serverRetentionDaysRef.current === null) {
      serverRetentionDaysRef.current = loadedRetentionDays;
      updateRetentionDays(loadedRetentionDays);
      return;
    }

    if (serverRetentionDaysRef.current !== loadedRetentionDays) {
      serverRetentionDaysRef.current = loadedRetentionDays;
      updateRetentionDays(loadedRetentionDays);
    }
  }, [preferences.data, retentionMutation.isPending]);

  function updateRetentionDays(value: string) {
    if (retentionDaysRef.current === value) {
      return;
    }
    retentionDaysRef.current = value;
    setRetentionDays(value);
  }

  function handleRetentionDaysChange(value: string) {
    // A late initial preferences response must not replace a value the user is editing.
    retentionWasEditedRef.current = true;
    updateRetentionDays(value);
  }

  function saveRetentionPreference() {
    Keyboard.dismiss();
    const days = parseRetentionDays(retentionDays);

    if (days === undefined) {
      setNotice({
        title: "Retention preference needs attention",
        body: "Enter a whole number from 0 to 365 days.",
        tone: "warning",
      });
      return;
    }

    updateRetentionDays(String(days));
    retentionMutation.mutate(days);
  }

  function beginDelete() {
    Keyboard.dismiss();
    setDeleteOpen(true);
    setDeleteConfirmation("");
    setNotice(null);
  }

  function cancelDelete() {
    setDeleteOpen(false);
    setDeleteConfirmation("");
  }

  function deleteAccount() {
    Keyboard.dismiss();
    if (deleteConfirmation.trim().toUpperCase() !== "DELETE") {
      setNotice({
        title: "Confirmation is required",
        body: "Type DELETE to permanently remove the current local account from this API.",
        tone: "warning",
      });
      return;
    }
    deleteMutation.mutate();
  }

  return (
    <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScreenShell contentStyle={styles.content}>
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Return to profile"
              onPress={() => router.back()}
              style={[styles.backButton, { backgroundColor: palette.controlSurface, borderColor: palette.border }]}
            >
              <Text style={[styles.backButtonText, { color: palette.actionText }]}>Back</Text>
            </Pressable>
            <Text style={[styles.eyebrow, { color: palette.actionText }]}>Privacy controls</Text>
            <Text style={[styles.title, { color: palette.ink }]}>Your data, clearly explained.</Text>
            <Text style={[styles.body, { color: palette.muted }]}>Review the local controls available today and the protections that are still planned.</Text>
          </View>

          {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

          <Card tone="insight">
            <SectionHeader title="Current preview" meta="Local API" />
            <Text style={[styles.body, { color: palette.muted }]}>Meal and label photos are sent only when you explicitly analyze them. Temporary meal-analysis inputs are normalized and stored privately only through the short review window. After you log a meal, they are deleted unless you explicitly choose to keep its scan photos. Cleanup retries safely if storage is unavailable.</Text>
            <StatusPill label="Photos are never retained automatically" tone="success" />
          </Card>

          <Card>
            <SectionHeader title="Image-retention preference" meta={preferences.isLoading ? "Loading..." : "Saved-meal photos"} />
            <Text style={[styles.body, { color: palette.muted }]}>Choose how long to keep a scan photo only when you explicitly select Keep scan photos while logging a camera-reviewed meal. This never changes temporary analysis-input cleanup, restores deleted images, or retains a photo automatically.</Text>
            {preferences.isError ? (
              <InlineNotice
                title="Retention preference could not load"
                body={presentApiError(preferences.error, "We couldn't load that preference right now.").body}
                tone="warning"
                actions={[{ label: "Retry", onPress: () => void preferences.refetch(), variant: "secondary" }]}
              />
            ) : null}
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: palette.muted }]}>Preferred retention days</Text>
              <TextInput
                accessibilityLabel="Preferred image retention days"
                accessibilityHint="A whole number from 0 to 365. This controls how long a scan photo is kept only after you explicitly choose to retain it with a saved meal."
                keyboardType="number-pad"
                maxLength={3}
                onChangeText={handleRetentionDaysChange}
                onSubmitEditing={Keyboard.dismiss}
                placeholder="30"
                placeholderTextColor={palette.muted}
                returnKeyType="done"
                style={[styles.input, { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink }]}
                value={retentionDays}
              />
              <Text style={[styles.caption, { color: palette.muted }]}>{retentionSummary(parseRetentionDays(retentionDays) ?? 30)}</Text>
            </View>
            <ActionButton
              label={retentionMutation.isPending ? "Saving preference..." : "Save retention preference"}
              variant="secondary"
              onPress={saveRetentionPreference}
              disabled={retentionMutation.isPending || preferences.isLoading}
              accessibilityHint="Saves how long explicitly retained scan photos stay with a saved meal. It does not change temporary analysis-image cleanup."
            />
          </Card>

          <Card>
            <SectionHeader title="JSON data export" meta="Current account" />
            <Text style={[styles.body, { color: palette.muted }]}>Prepare a JSON snapshot of your profile, preferences, goals, meals, recipes, saved foods, weight, and hydration entries from the current API session.</Text>
            <ActionButton
              label={exportMutation.isPending ? "Preparing export..." : "Prepare JSON export"}
              onPress={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              accessibilityHint="Prepares a reviewable JSON snapshot of the current local account data."
            />
            {exportData ? (
              <>
                <ExportSummary exportData={exportData} />
                <View
                  accessibilityLabel="Export sharing guidance"
                  style={[styles.shareGuidance, { backgroundColor: palette.cardSoft, borderColor: palette.border }]}
                >
                  <Text style={[styles.shareGuidanceTitle, { color: palette.warningText }]}>Share only with someone you trust</Text>
                  <Text style={[styles.caption, { color: palette.muted }]}>This export can include meal history, nutrition goals, weight, and hydration data. Anyone you share it with may keep a copy. Living Nutrition does not receive the recipient or control their copy after sharing.</Text>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel="I understand the export may contain sensitive nutrition data"
                    accessibilityHint="Required before opening the system share sheet."
                    accessibilityState={{ checked: shareAcknowledged }}
                    onPress={() => setShareAcknowledged((current) => !current)}
                    style={[styles.shareAcknowledgement, { borderColor: palette.border }]}
                  >
                    <View style={[styles.shareCheckbox, { backgroundColor: shareAcknowledged ? palette.highlight : palette.controlSurface, borderColor: palette.border }]}>
                      {shareAcknowledged ? <Text style={[styles.shareCheckmark, { color: palette.onPrimary }]}>✓</Text> : null}
                    </View>
                    <Text style={[styles.caption, styles.shareAcknowledgementCopy, { color: palette.ink }]}>I understand this export may contain sensitive personal nutrition data.</Text>
                  </Pressable>
                </View>
                <ActionButton
                  label={shareExportMutation.isPending ? "Opening share sheet..." : "Share JSON export"}
                  variant="secondary"
                  onPress={() => shareExportMutation.mutate()}
                  disabled={shareExportMutation.isPending || !shareAcknowledged}
                  accessibilityHint="After acknowledging the recipient guidance, creates a temporary JSON file, opens the system share sheet, then removes the cache file."
                />
              </>
            ) : null}
          </Card>

          <Card>
            <SectionHeader title="Security activity" meta="Recent account events" />
            <Text style={[styles.body, { color: palette.muted }]}>Review recent local-account actions. This view never shows credentials, tokens, device fingerprints, meal data, or request IDs.</Text>
            {securityActivity.isLoading ? <Text style={[styles.caption, { color: palette.muted }]}>Loading recent activity...</Text> : null}
            {securityActivity.isError ? (
              <InlineNotice
                title="Security activity could not load"
                body={presentApiError(securityActivity.error, "We couldn't load recent account activity right now.").body}
                tone="warning"
                actions={[{ label: "Retry", onPress: () => void securityActivity.refetch(), variant: "secondary" }]}
              />
            ) : null}
            {securityActivity.data ? <SecurityActivityPanel items={securityActivity.data.items} /> : null}
          </Card>

          <Card tone="soft">
            <SectionHeader title="Delete app data" meta="Irreversible" />
            <Text style={[styles.body, { color: palette.muted }]}>This permanently removes your Living Nutrition app data: meals, recipes, goals, weight, hydration, saved foods, local queued meals, and any remaining private image assets from this API and device. It does not delete your Clerk identity or data held by other services.</Text>
            {!deleteOpen ? (
              <ActionButton
                label="Review app-data deletion"
                variant="secondary"
                onPress={beginDelete}
                accessibilityHint="Opens an irreversible Living Nutrition app-data deletion confirmation."
              />
            ) : (
              <View style={[styles.deleteConfirmation, { backgroundColor: palette.dangerSurface, borderColor: palette.border }]}>
                <Text style={[styles.deleteTitle, { color: palette.dangerText }]}>Confirm permanent app-data deletion</Text>
                <Text style={[styles.body, { color: palette.muted }]}>Type DELETE below to continue. This does not create a reversible archive, delete your Clerk identity, or delete data from systems outside Living Nutrition.</Text>
                <TextInput
                  accessibilityLabel="Type DELETE to confirm app-data deletion"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={setDeleteConfirmation}
                  placeholder="DELETE"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink }]}
                  value={deleteConfirmation}
                />
                <View style={styles.deleteActions}>
                  <ActionButton label="Cancel" variant="secondary" onPress={cancelDelete} style={styles.deleteAction} />
                  <ActionButton
                    label={deleteMutation.isPending ? "Deleting app data..." : "Delete app data"}
                    variant="ghost"
                    onPress={deleteAccount}
                    disabled={deleteMutation.isPending || deleteConfirmation.trim().toUpperCase() !== "DELETE"}
                    style={styles.deleteAction}
                    accessibilityHint="Permanently deletes the current Living Nutrition app data after the confirmation word matches."
                  />
                </View>
              </View>
            )}
          </Card>
        </ScreenShell>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

function SecurityActivityPanel({ items }: { items: SecurityActivity[] }) {
  const { palette } = useTheme();

  if (!items.length) {
    return <Text style={[styles.caption, { color: palette.muted }]}>No local-account activity is available yet.</Text>;
  }

  return (
    <View accessibilityLabel="Recent security activity" style={styles.activityList}>
      {items.map((item) => {
        const label = securityActivityLabel(item.eventType);
        const timestamp = formatActivityTimestamp(item.createdAt);
        const successful = item.outcome === "success";
        return (
          <View
            key={item.id}
            accessibilityLabel={`${label}. ${successful ? "Completed" : "Needs review"}. ${timestamp}.`}
            style={[styles.activityRow, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}
          >
            <View style={styles.activityCopy}>
              <Text style={[styles.activityTitle, { color: palette.ink }]}>{label}</Text>
              <Text style={[styles.caption, { color: palette.muted }]}>{timestamp}</Text>
            </View>
            <StatusPill label={successful ? "Completed" : "Needs review"} tone={successful ? "success" : "warning"} />
          </View>
        );
      })}
    </View>
  );
}

function ExportSummary({ exportData }: { exportData: UserDataExport }) {
  const { palette } = useTheme();
  const rows = [
    ["Meals", exportData.meals.length],
    ["Recipes", exportData.recipes.length],
    ["Saved foods", exportData.favoriteFoods.length + exportData.recentFoods.length + exportData.customFoods.length],
    ["Weight entries", exportData.weightEntries.length],
    ["Hydration entries", exportData.hydrationEntries.length],
  ] as const;

  return (
    <View accessibilityLabel="Prepared JSON export summary" style={[styles.exportSummary, { backgroundColor: palette.surfaceAlt, borderColor: palette.border }]}>
      <Text style={[styles.exportTitle, { color: palette.ink }]}>Export snapshot ready</Text>
      <Text style={[styles.exportRow, { color: palette.muted }]}>Format: {exportData.formatVersion}</Text>
      {rows.map(([label, value]) => (
        <Text key={label} style={[styles.exportRow, { color: palette.muted }]}>{`${label}: ${value}`}</Text>
      ))}
    </View>
  );
}

function parseRetentionDays(value: string) {
  if (!/^\d+$/.test(value.trim())) return undefined;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : undefined;
}

function retentionSummary(days: number) {
  if (days === 0) return "Scan photos are deleted after confirmation; keeping a photo with a saved meal is unavailable until you choose at least one day.";
  if (days === 1) return "A scan photo you explicitly keep with a saved meal will be deleted after one day.";
  return `A scan photo you explicitly keep with a saved meal will be deleted after ${days} days.`;
}

function securityActivityLabel(eventType: string) {
  const labels: Record<string, string> = {
    "auth.register": "Account created",
    "auth.login": "Signed in",
    "auth.refresh": "Session refreshed",
    "auth.logout": "Signed out",
    "auth.password_change": "Password changed",
    "auth.session_revoke": "Another session revoked",
    "user_data.export": "JSON export prepared",
    "user_data.account_delete": "Account deletion requested",
  };
  return labels[eventType] || "Account activity";
}

function formatActivityTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recent activity" : date.toLocaleString();
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: 150 },
  header: { gap: spacing.sm, paddingBottom: spacing.xs },
  backButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md },
  backButtonText: { ...typography.button },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.display },
  body: { ...typography.body, lineHeight: 22 },
  caption: { ...typography.caption, lineHeight: 18 },
  inputGroup: { gap: spacing.xs },
  inputLabel: { ...typography.caption },
  input: { minHeight: 52, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, ...typography.body },
  exportSummary: { gap: spacing.xxs, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  exportTitle: { ...typography.heading },
  exportRow: { ...typography.caption },
  shareGuidance: { gap: spacing.sm, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  shareGuidanceTitle: { ...typography.button },
  shareAcknowledgement: { minHeight: 44, alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xxs },
  shareCheckbox: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth },
  shareCheckmark: { fontSize: 16, fontWeight: "800", lineHeight: 20 },
  shareAcknowledgementCopy: { flex: 1 },
  activityList: { gap: spacing.xs },
  activityRow: { minHeight: 52, alignItems: "center", borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  activityCopy: { flex: 1, gap: spacing.xxs },
  activityTitle: { ...typography.button },
  deleteConfirmation: { gap: spacing.sm, borderRadius: radii.md, borderWidth: 1, padding: spacing.md },
  deleteTitle: { ...typography.heading },
  deleteActions: { flexDirection: "row", gap: spacing.sm },
  deleteAction: { flex: 1 },
});
