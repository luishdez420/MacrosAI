import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";

type Tone = "neutral" | "success" | "warning" | "danger" | "protein" | "carbs" | "fat";

type ScreenShellProps = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

type ActionButtonProps = {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
};

type InlineNoticeAction = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
};

export function ScreenShell({ children, scroll = true, contentStyle }: ScreenShellProps) {
  if (!scroll) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={[styles.staticContent, contentStyle]}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scrollContent, contentStyle]}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({
  children,
  tone = "surface",
  style,
}: {
  children: ReactNode;
  tone?: "surface" | "soft" | "accent";
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, cardToneStyles[tone], style]}>{children}</View>;
}

export function SectionHeader({
  title,
  meta,
}: {
  title: string;
  meta?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

export function StatusPill({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const toneStyle = pillToneStyles[tone];

  return (
    <View style={[styles.statusPill, toneStyle.container, style]}>
      <Text numberOfLines={1} style={[styles.statusPillText, toneStyle.text]}>
        {label}
      </Text>
    </View>
  );
}

export function SourceBadge({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const toneStyle = sourceToneStyles[tone];

  return (
    <View style={[styles.sourceBadge, toneStyle.container, style]}>
      <Text numberOfLines={1} style={[styles.sourceBadgeText, toneStyle.text]}>
        {label}
      </Text>
    </View>
  );
}

export function MacroStatTile({
  label,
  value,
  suffix,
  tone = "neutral",
  style,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.macroTile, style]}>
      <Text style={[styles.macroValue, macroToneStyles[tone]]}>
        {value}
        {suffix}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

export function InlineNotice({
  title,
  body,
  tone = "neutral",
  actions,
}: {
  title: string;
  body: string;
  tone?: Tone;
  actions?: InlineNoticeAction[];
}) {
  const toneStyle = noticeToneStyles[tone];

  return (
    <View style={[styles.notice, toneStyle.container]}>
      <Text style={[styles.noticeTitle, toneStyle.text]}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {actions?.length ? (
        <View style={styles.noticeActions}>
          {actions.map((action) => (
            <ActionButton
              key={action.label}
              label={action.label}
              variant={action.variant ?? "secondary"}
              onPress={action.onPress}
              style={styles.noticeActionButton}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ActionButton({
  label,
  variant = "primary",
  disabled,
  onPress,
  style,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.actionButton,
        actionButtonStyles[variant],
        disabled ? styles.disabled : undefined,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.actionButtonText, actionButtonTextStyles[variant]]}>{label}</Text>
    </Pressable>
  );
}

export function sourceLabel(provider?: string) {
  if (!provider) {
    return "Source matched";
  }

  return `${provider.replaceAll("_", " ").toUpperCase()} matched`;
}

export function readableFoodName(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();

  if (!compact) {
    return "Logged food";
  }

  if (compact === compact.toUpperCase()) {
    return compact
      .toLowerCase()
      .split(" ")
      .map((word) => {
        if (word.length <= 2 || word.includes("&")) {
          return word.toUpperCase();
        }

        return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
      })
      .join(" ");
  }

  return compact;
}

const toneColors: Record<Tone, { text: string; background: string }> = {
  neutral: {
    text: colors.muted,
    background: colors.surfaceAlt,
  },
  success: {
    text: colors.green,
    background: colors.surfaceAlt,
  },
  warning: {
    text: colors.carbs,
    background: "#F6ECD3",
  },
  danger: {
    text: colors.coral,
    background: "#F8E3DC",
  },
  protein: {
    text: colors.protein,
    background: "#F8E3DC",
  },
  carbs: {
    text: colors.carbs,
    background: "#F6ECD3",
  },
  fat: {
    text: colors.fat,
    background: "#DCECEF",
  },
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 112,
    gap: spacing.lg,
  },
  staticContent: {
    flex: 1,
    padding: spacing.lg,
    paddingBottom: 112,
    gap: spacing.lg,
  },
  card: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.muted,
    flexShrink: 0,
  },
  statusPill: {
    minHeight: 34,
    maxWidth: 118,
    alignSelf: "flex-start",
    flexShrink: 0,
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusPillText: {
    ...typography.caption,
  },
  sourceBadge: {
    alignSelf: "flex-start",
    maxWidth: 172,
    overflow: "hidden",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sourceBadgeText: {
    ...typography.caption,
  },
  macroTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  macroValue: {
    ...typography.stat,
  },
  macroLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  notice: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  noticeTitle: {
    ...typography.heading,
  },
  noticeBody: {
    ...typography.body,
    color: colors.muted,
  },
  noticeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  noticeActionButton: {
    flexGrow: 1,
  },
  actionButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    ...typography.button,
  },
  disabled: {
    opacity: 0.62,
  },
});

const cardToneStyles = StyleSheet.create({
  surface: {
    backgroundColor: colors.surface,
  },
  soft: {
    backgroundColor: colors.surfaceAlt,
  },
  accent: {
    backgroundColor: colors.lime,
  },
});

const actionButtonStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.green,
  },
  secondary: {
    backgroundColor: colors.surfaceAlt,
  },
  ghost: {
    backgroundColor: "transparent",
  },
});

const actionButtonTextStyles = StyleSheet.create({
  primary: {
    color: colors.white,
  },
  secondary: {
    color: colors.ink,
  },
  ghost: {
    color: colors.green,
  },
});

const pillToneStyles = createToneStyleMap();
const sourceToneStyles = createToneStyleMap();
const noticeToneStyles = createToneStyleMap();

const macroToneStyles: Record<Tone, StyleProp<TextStyle>> = {
  neutral: { color: colors.ink },
  success: { color: colors.green },
  warning: { color: colors.carbs },
  danger: { color: colors.coral },
  protein: { color: colors.protein },
  carbs: { color: colors.carbs },
  fat: { color: colors.fat },
};

function createToneStyleMap() {
  return Object.fromEntries(
    Object.entries(toneColors).map(([tone, value]) => [
      tone,
      StyleSheet.create({
        container: {
          backgroundColor: value.background,
        },
        text: {
          color: value.text,
        },
      }),
    ])
  ) as Record<Tone, { container: ViewStyle; text: TextStyle }>;
}
