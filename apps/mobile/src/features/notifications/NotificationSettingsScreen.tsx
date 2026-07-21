import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { radii, spacing, typography } from "@living-nutrition/design-tokens";
import { getStoredUserId } from "../../services/api";
import {
  disableHydrationReminder,
  enableHydrationReminder,
  formatReminderTime,
  getHydrationReminderSettings,
  isValidReminderTime,
  type HydrationReminderSettings,
} from "../../services/hydrationReminder";
import {
  ActionButton,
  Card,
  InlineNotice,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

const timeSuggestions = ["09:00", "15:00", "19:00"];

export function NotificationSettingsScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const [accountScope, setAccountScope] = useState<string | undefined>();
  const [settings, setSettings] = useState<HydrationReminderSettings | null>(null);
  const [time, setTime] = useState("15:00");
  const [notice, setNotice] = useState<{ title: string; body: string; tone: "warning" | "success" } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      const scope = await getStoredUserId().catch(() => undefined);
      const loaded = await getHydrationReminderSettings(scope);

      if (!active) return;
      setAccountScope(scope);
      setSettings(loaded);
      setTime(loaded.time);
    })().catch(() => {
      if (!active) return;
      setSettings(null);
      setNotice({
        title: "Reminder settings could not load",
        body: "Try again before enabling a reminder. Your existing device notification was not changed.",
        tone: "warning",
      });
    });

    return () => {
      active = false;
    };
  }, []);

  async function enableReminder() {
    if (!isValidReminderTime(time)) {
      setNotice({
        title: "Choose a valid time",
        body: "Use 24-hour time in the form HH:MM, for example 15:00.",
        tone: "warning",
      });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await enableHydrationReminder(time, accountScope);
      setSettings(result.settings);
      setTime(result.settings.time);
      setNotice(
        result.status === "enabled"
          ? {
              title: "Daily check-in scheduled",
              body: `Living Nutrition will send one optional local reminder each day at ${formatReminderTime(result.settings.time)}. You can turn it off here at any time.`,
              tone: "success",
            }
          : {
              title: "Notifications are off",
              body: "Allow notifications for Living Nutrition in your device settings, then return here to enable this optional reminder.",
              tone: "warning",
            }
      );
    } catch (error) {
      setNotice({
        title: "Reminder was not scheduled",
        body: error instanceof Error ? error.message : "Try again. Your device notification settings were not changed.",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  async function disableReminder() {
    setBusy(true);
    setNotice(null);
    try {
      const updated = await disableHydrationReminder(accountScope);
      setSettings(updated);
      setTime(updated.time);
      setNotice({
        title: "Daily check-in turned off",
        body: "No future Living Nutrition hydration reminders are scheduled on this device.",
        tone: "success",
      });
    } catch {
      setNotice({
        title: "Reminder could not be turned off",
        body: "Try again. If the issue continues, review this app's notification settings on your device.",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  }

  const enabled = settings?.enabled === true;
  const status = settings === null ? "Loading" : enabled ? "On" : "Off";

  return (
    <ScreenShell>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return to profile"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: palette.controlSurface, borderColor: palette.border }]}
        >
          <Ionicons name="chevron-back" size={20} color={palette.ink} />
          <Text style={[styles.backText, { color: palette.actionText }]}>Profile</Text>
        </Pressable>
        <Text style={[styles.eyebrow, { color: palette.actionText }]}>Notifications</Text>
        <Text style={[styles.title, { color: palette.ink }]}>A gentle check-in, on your terms.</Text>
        <Text style={[styles.body, { color: palette.muted }]}>Set one optional daily reminder to revisit your hydration log. It has no target, health score, or pressure to act.</Text>
      </View>

      {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

      <Card tone="insight">
        <SectionHeader title="Daily hydration check-in" meta={status} />
        <View style={styles.statusRow}>
          <View style={[styles.iconCircle, { backgroundColor: palette.controlSurface }]}>
            <Ionicons name="water-outline" size={22} color={palette.actionText} />
          </View>
          <View style={styles.statusCopy}>
            <Text style={[styles.statusTitle, { color: palette.ink }]}>{enabled ? `Scheduled for ${formatReminderTime(time)}` : "Not scheduled"}</Text>
            <Text style={[styles.statusBody, { color: palette.muted }]}>{enabled ? "This reminder is local to this device and can be turned off below." : "Reminders stay off unless you choose to enable one."}</Text>
          </View>
          <StatusPill label={status} tone={enabled ? "success" : "neutral"} />
        </View>
      </Card>

      <Card>
        <SectionHeader title="Reminder time" meta="Local time" />
        <Text style={[styles.body, { color: palette.muted }]}>Use 24-hour time. The reminder follows this device's current time zone.</Text>
        <TextInput
          accessibilityLabel="Daily reminder time"
          accessibilityHint="Enter a local time in 24-hour HH:MM format"
          value={time}
          onChangeText={setTime}
          editable={!busy}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="15:00"
          placeholderTextColor={palette.muted}
          style={[styles.timeInput, { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink }]}
        />
        <View accessibilityRole="radiogroup" accessibilityLabel="Suggested reminder times" style={styles.suggestionRow}>
          {timeSuggestions.map((suggestion) => {
            const selected = time === suggestion;
            return (
              <Pressable
                key={suggestion}
                accessibilityRole="radio"
                accessibilityLabel={`Use ${formatReminderTime(suggestion)} for the daily reminder`}
                accessibilityState={{ selected, disabled: busy }}
                disabled={busy}
                onPress={() => setTime(suggestion)}
                style={[styles.suggestion, { backgroundColor: selected ? palette.actionText : palette.controlSurface, borderColor: palette.border }]}
              >
                <Text style={[styles.suggestionText, { color: selected ? palette.onPrimary : palette.ink }]}>{formatReminderTime(suggestion)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card tone="soft">
        <SectionHeader title="Your control" meta="No pressure" />
        <View style={styles.promiseList}>
          <Text style={[styles.promise, { color: palette.ink }]}>• One daily local reminder only, never a repeated prompt.</Text>
          <Text style={[styles.promise, { color: palette.ink }]}>• No hydration target, recommendation, or medical claim is attached.</Text>
          <Text style={[styles.promise, { color: palette.ink }]}>• Disable it here or in your device notification settings whenever you want.</Text>
        </View>
        {Platform.OS === "web" ? <Text style={[styles.caption, { color: palette.muted }]}>Open the iOS or Android app to schedule a device reminder.</Text> : null}
      </Card>

      {enabled ? (
        <ActionButton
          label={busy ? "Turning off..." : "Turn off daily reminder"}
          variant="secondary"
          onPress={() => void disableReminder()}
          disabled={busy}
          accessibilityHint="Cancels the scheduled local hydration reminder on this device."
        />
      ) : (
        <ActionButton
          label={busy ? "Scheduling reminder..." : "Enable daily reminder"}
          onPress={() => void enableReminder()}
          disabled={busy || settings === null || Platform.OS === "web"}
          accessibilityHint="Requests notification permission only when you choose to schedule this optional local reminder."
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  backButton: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  backText: { ...typography.caption },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.display, maxWidth: 360 },
  body: { ...typography.body },
  caption: { ...typography.caption },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconCircle: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  statusCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  statusTitle: { ...typography.caption },
  statusBody: { ...typography.caption, fontWeight: "500" },
  timeInput: { minHeight: 52, marginTop: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.body, fontVariant: ["tabular-nums"] },
  suggestionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  suggestion: { minHeight: 44, justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  suggestionText: { ...typography.caption, fontVariant: ["tabular-nums"] },
  promiseList: { gap: spacing.sm },
  promise: { ...typography.body },
});
