import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { radii, spacing, typography } from "@living-nutrition/design-tokens";
import {
  ActionButton,
  Card,
  InlineNotice,
  ScreenShell,
  SectionHeader,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

type DeviceAccessibilityState = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
  screenReader: boolean;
  loading: boolean;
};

const initialState: DeviceAccessibilityState = {
  reduceMotion: false,
  reduceTransparency: false,
  screenReader: false,
  loading: true,
};

export function AccessibilitySettingsScreen() {
  const router = useRouter();
  const { palette, preference } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [settings, setSettings] = useState<DeviceAccessibilityState>(initialState);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    setNotice(null);
    setSettings((current) => ({ ...current, loading: true }));

    try {
      const [reduceMotion, reduceTransparency, screenReader] = await Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        AccessibilityInfo.isReduceTransparencyEnabled(),
        AccessibilityInfo.isScreenReaderEnabled(),
      ]);
      setSettings({ reduceMotion, reduceTransparency, screenReader, loading: false });
    } catch {
      setSettings((current) => ({ ...current, loading: false }));
      setNotice("Your device accessibility preferences could not be refreshed. The app will continue using its current safe defaults.");
    }
  }, []);

  useEffect(() => {
    void refreshSettings();

    const motionSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setSettings((current) => ({ ...current, reduceMotion: enabled, loading: false }));
    });
    const transparencySubscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (enabled) => {
      setSettings((current) => ({ ...current, reduceTransparency: enabled, loading: false }));
    });
    const screenReaderSubscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => {
      setSettings((current) => ({ ...current, screenReader: enabled, loading: false }));
    });

    return () => {
      motionSubscription.remove();
      transparencySubscription.remove();
      screenReaderSubscription.remove();
    };
  }, [refreshSettings]);

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
        <Text style={[styles.eyebrow, { color: palette.actionText }]}>Accessibility</Text>
        <Text style={[styles.title, { color: palette.ink }]}>Designed to follow your device.</Text>
        <Text style={[styles.body, { color: palette.muted }]}>Living Nutrition respects text size, motion, transparency, screen-reader, and appearance preferences. Device settings remain in your control.</Text>
      </View>

      {notice ? <InlineNotice title="Accessibility settings need attention" body={notice} tone="warning" /> : null}

      <Card tone="insight">
        <SectionHeader title="Current device settings" meta={settings.loading ? "Checking..." : "Live"} />
        <Text style={[styles.body, { color: palette.muted }]}>These statuses are read from the device. Return here after changing an accessibility preference to review it again.</Text>
        <View accessibilityRole="summary" accessibilityLabel={accessibilitySummary(settings, fontScale)} style={styles.settingList}>
          <AccessibilitySettingRow
            icon="text-outline"
            label="Text size"
            value={formatTextScale(fontScale)}
            description="Text uses your device scale. Layouts should wrap instead of hiding important nutrition details."
            loading={settings.loading}
          />
          <AccessibilitySettingRow
            icon="speedometer-outline"
            label="Reduce motion"
            value={settings.reduceMotion ? "On" : "Off"}
            description={settings.reduceMotion ? "Camera, macro-ring, and timeline motion use reduced movement." : "Motion remains subtle and never blocks logging."}
            enabled={settings.reduceMotion}
            loading={settings.loading}
          />
          <AccessibilitySettingRow
            icon="contrast-outline"
            label="Reduce transparency"
            value={settings.reduceTransparency ? "On" : "Off"}
            description={settings.reduceTransparency ? "Glass surfaces use opaque fallbacks for clearer contrast." : "Glass surfaces remain available with text contrast preserved."}
            enabled={settings.reduceTransparency}
            loading={settings.loading}
          />
          <AccessibilitySettingRow
            icon="volume-high-outline"
            label="Screen reader"
            value={settings.screenReader ? "On" : "Off"}
            description={settings.screenReader ? "Interactive controls provide spoken labels, states, and recovery hints." : "Screen-reader labels remain available whenever you enable one."}
            enabled={settings.screenReader}
            loading={settings.loading}
          />
        </View>
      </Card>

      <Card>
        <SectionHeader title="App appearance" meta={appearanceLabel(preference)} />
        <Text style={[styles.body, { color: palette.muted }]}>Your selected app appearance is applied alongside device accessibility settings. You can change it from Profile without disabling system text, motion, or transparency preferences.</Text>
        <ActionButton label="Return to appearance settings" variant="secondary" onPress={() => router.back()} accessibilityHint="Returns to Profile, where you can change the app appearance." />
      </Card>

      <Card tone="soft">
        <SectionHeader title="How this app stays readable" meta="Built in" />
        <View style={styles.promiseList}>
          <Text style={[styles.promise, { color: palette.ink }]}>• Macro categories use labels as well as color.</Text>
          <Text style={[styles.promise, { color: palette.ink }]}>• Camera and food-review controls include spoken labels and recovery guidance.</Text>
          <Text style={[styles.promise, { color: palette.ink }]}>• Nutrition estimates remain reviewable before a meal is saved.</Text>
        </View>
        <Text style={[styles.caption, { color: palette.muted }]}>A full VoiceOver, contrast, and dynamic-type audit is still in progress. If a control is difficult to use, choose a manual logging route rather than relying on a scan.</Text>
      </Card>

      <ActionButton label={settings.loading ? "Refreshing device settings..." : "Refresh device settings"} variant="secondary" onPress={() => void refreshSettings()} disabled={settings.loading} accessibilityHint="Reads the current motion, transparency, and screen-reader preferences from this device." />
    </ScreenShell>
  );
}

function AccessibilitySettingRow({
  icon,
  label,
  value,
  description,
  enabled = false,
  loading,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  description: string;
  enabled?: boolean;
  loading: boolean;
}) {
  const { palette } = useTheme();

  return (
    <View accessibilityLabel={`${label}: ${loading ? "Checking" : value}. ${description}`} style={[styles.settingRow, { borderTopColor: palette.border }]}>
      <View style={[styles.settingIcon, { backgroundColor: palette.controlSurface }]}>
        <Ionicons name={icon} size={20} color={palette.actionText} />
      </View>
      <View style={styles.settingCopy}>
        <Text style={[styles.settingLabel, { color: palette.ink }]}>{label}</Text>
        <Text style={[styles.settingDescription, { color: palette.muted }]}>{description}</Text>
      </View>
      <StatusPill label={loading ? "Checking" : value} tone={enabled ? "success" : "neutral"} />
    </View>
  );
}

export function formatTextScale(fontScale: number) {
  return `${Math.round(fontScale * 100)}%`;
}

export function appearanceLabel(preference: "system" | "light" | "dark") {
  return preference === "system" ? "Follow system" : preference === "dark" ? "Dark" : "Light";
}

export function accessibilitySummary(settings: DeviceAccessibilityState, fontScale: number) {
  if (settings.loading) {
    return "Checking device accessibility settings.";
  }

  return `Text size ${formatTextScale(fontScale)}. Reduce motion ${settings.reduceMotion ? "on" : "off"}. Reduce transparency ${settings.reduceTransparency ? "on" : "off"}. Screen reader ${settings.screenReader ? "on" : "off"}.`;
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  backButton: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.pill, paddingHorizontal: spacing.md },
  backText: { ...typography.caption },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.display, maxWidth: 360 },
  body: { ...typography.body },
  caption: { ...typography.caption },
  settingList: { marginTop: spacing.xs },
  settingRow: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md },
  settingIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  settingCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  settingLabel: { ...typography.caption },
  settingDescription: { ...typography.caption, fontWeight: "500" },
  promiseList: { gap: spacing.sm },
  promise: { ...typography.body },
});
