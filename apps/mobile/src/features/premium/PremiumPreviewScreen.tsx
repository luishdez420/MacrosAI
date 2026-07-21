import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { ActionButton, Card, InlineNotice, ScreenShell, SectionHeader, StatusPill } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

type PreviewFeature = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const availableNow: PreviewFeature[] = [
  {
    title: "Source-backed logging",
    description: "Search, scan, or review a food before saving it, with provider and confidence language kept visible.",
    icon: "shield-checkmark-outline",
  },
  {
    title: "Editable meal review",
    description: "Confirm portions, replace a match, and add provider-backed extras before a meal affects your diary.",
    icon: "create-outline",
  },
  {
    title: "Private local controls",
    description: "Manage your local profile, goals, appearance, reminders, and current data controls from Profile.",
    icon: "options-outline",
  },
];

const plannedFeatures: PreviewFeature[] = [
  {
    title: "Deeper trend views",
    description: "More flexible comparisons and long-range nutrition patterns, built on confirmed meal snapshots.",
    icon: "trending-up-outline",
  },
  {
    title: "Connected health services",
    description: "Optional integrations will be introduced only with clear permissions and an understandable data boundary.",
    icon: "link-outline",
  },
  {
    title: "Membership options",
    description: "Any future subscription will explain its price, features, renewal terms, and alternatives before asking you to buy.",
    icon: "sparkles-outline",
  },
];

export function PremiumPreviewScreen() {
  const router = useRouter();
  const { palette } = useTheme();

  return (
    <ScreenShell testID="premium-preview-screen">
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
        <Text style={[styles.eyebrow, { color: palette.actionText }]}>Living Nutrition</Text>
        <Text style={[styles.title, { color: palette.ink }]}>A clearer view of what comes next.</Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          This is a preview, not a checkout. Your current logging tools stay available without a membership while we build the next layer carefully.
        </Text>
      </View>

      <Card tone="accent" style={styles.heroCard}>
        <View style={styles.heroTopline}>
          <View style={[styles.heroIcon, { backgroundColor: palette.mode === "dark" ? "rgba(196, 234, 117, 0.16)" : "rgba(196, 234, 117, 0.42)" }]}>
            <Ionicons name="leaf-outline" size={26} color={palette.actionText} />
          </View>
          <StatusPill label="Preview" tone="warning" />
        </View>
        <Text style={[styles.heroTitle, { color: palette.ink }]}>Premium should add clarity, not pressure.</Text>
        <Text style={[styles.heroBody, { color: palette.muted }]}>We will only introduce paid options when the experience, pricing, and data controls are ready to explain plainly.</Text>
      </Card>

      <Card>
        <SectionHeader title="Available now" meta="Included" />
        <Text style={[styles.sectionBody, { color: palette.muted }]}>These are live tools, not promised benefits.</Text>
        <FeatureList features={availableNow} tone="success" />
      </Card>

      <Card tone="soft">
        <SectionHeader title="In development" meta="Not yet available" />
        <Text style={[styles.sectionBody, { color: palette.muted }]}>These are product directions, not a purchase offer or guaranteed release schedule.</Text>
        <FeatureList features={plannedFeatures} tone="warning" />
      </Card>

      <InlineNotice
        title="No membership is required today"
        body="There is no payment flow, trial, hidden renewal, or feature lock in this preview. Continue using the source-backed logging tools already in the app."
        tone="success"
      />

      <ActionButton
        label="Keep using free tools"
        onPress={() => router.replace("/")}
        accessibilityHint="Returns to Today without starting a purchase or changing your account"
      />
      <ActionButton
        label="Review privacy controls"
        variant="secondary"
        onPress={() => router.push("/data-controls")}
        accessibilityHint="Opens data controls for your account"
      />
    </ScreenShell>
  );
}

function FeatureList({ features, tone }: { features: PreviewFeature[]; tone: "success" | "warning" }) {
  const { palette } = useTheme();
  const iconColor = tone === "success" ? colors.green : colors.carbs;

  return (
    <View style={styles.featureList}>
      {features.map((feature) => (
        <View key={feature.title} style={[styles.featureRow, { borderColor: palette.border }]} accessible accessibilityLabel={`${feature.title}. ${feature.description}`}>
          <View
            style={[
              styles.featureIcon,
              {
                backgroundColor:
                  tone === "success"
                    ? palette.mode === "dark"
                      ? "rgba(106, 180, 116, 0.18)"
                      : "rgba(28, 116, 83, 0.12)"
                    : palette.mode === "dark"
                      ? "rgba(229, 183, 78, 0.18)"
                      : "rgba(229, 183, 78, 0.16)",
              },
            ]}
          >
            <Ionicons name={feature.icon} size={20} color={iconColor} />
          </View>
          <View style={styles.featureCopy}>
            <Text style={[styles.featureTitle, { color: palette.ink }]}>{feature.title}</Text>
            <Text style={[styles.featureBody, { color: palette.muted }]}>{feature.description}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.sm },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  backText: { ...typography.button },
  eyebrow: { ...typography.eyebrow },
  title: { ...typography.display, maxWidth: 510 },
  body: { ...typography.body, lineHeight: 24, maxWidth: 570 },
  heroCard: { gap: spacing.md, overflow: "hidden" },
  heroTopline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  heroIcon: { alignItems: "center", borderRadius: radii.pill, height: 50, justifyContent: "center", width: 50 },
  heroTitle: { ...typography.heading, fontSize: 24, lineHeight: 29, maxWidth: 420 },
  heroBody: { ...typography.body, lineHeight: 23, maxWidth: 500 },
  sectionBody: { ...typography.body, lineHeight: 22, marginTop: -spacing.xs },
  featureList: { marginTop: spacing.sm },
  featureRow: { alignItems: "flex-start", borderTopWidth: 1, flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  featureIcon: { alignItems: "center", borderRadius: radii.md, height: 42, justifyContent: "center", width: 42 },
  featureCopy: { flex: 1, gap: 3 },
  featureTitle: { ...typography.heading, fontSize: 16, lineHeight: 21 },
  featureBody: { ...typography.caption, lineHeight: 19 },
});
