import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
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

import {
  colors,
  elevations,
  glass,
  radii,
  spacing,
  typography,
  type ThemePalette,
} from "@living-nutrition/design-tokens";
import { useTheme } from "../theme/ThemeProvider";
import { useScrollNavigation } from "./ScrollNavigationContext";

type Tone = "neutral" | "success" | "warning" | "danger" | "protein" | "carbs" | "fat" | "fiber" | "insight";
type GlassLevel = "navigation" | "content" | "utility";

type ScreenShellProps = {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

type ActionButtonProps = {
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "quiet" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  haptic?: "none" | "selection" | "light" | "medium";
};

type InlineNoticeAction = {
  label: string;
  onPress: () => void;
  variant?: ActionButtonProps["variant"];
  disabled?: boolean;
};

const swipeRevealDistance = 92;
const swipeRevealThreshold = 56;

export function shouldRevealSwipeAction(translationX: number, velocityX = 0) {
  return translationX <= -swipeRevealThreshold || velocityX <= -0.65;
}

function playHaptic(feedback: NonNullable<ActionButtonProps["haptic"]>) {
  if (feedback === "none") {
    return;
  }

  if (feedback === "selection") {
    void Haptics.selectionAsync().catch(() => undefined);
    return;
  }

  const style = feedback === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
  void Haptics.impactAsync(style).catch(() => undefined);
}

export function ScreenShell({ children, scroll = true, contentStyle, testID }: ScreenShellProps) {
  const { palette } = useTheme();
  const { onScroll } = useScrollNavigation();
  const content = scroll ? (
    <ScrollView
      testID={testID}
      contentContainerStyle={styles.scrollContent}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <View testID={testID ? `${testID}-content` : undefined} style={[styles.contentFrame, contentStyle]}>
        {children}
      </View>
    </ScrollView>
  ) : (
    <View testID={testID} style={[styles.staticContent, styles.contentFrame, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[palette.backgroundWarm, palette.background, palette.backgroundDeep]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[styles.atmosphereOrb, styles.atmosphereOrbTop, { backgroundColor: palette.orbPrimary }]} />
      <View pointerEvents="none" style={[styles.atmosphereOrb, styles.atmosphereOrbBottom, { backgroundColor: palette.orbSecondary }]} />
      {content}
    </SafeAreaView>
  );
}

export function GlassSurface({
  children,
  level = "content",
  style,
  contentStyle,
  blur = true,
}: {
  children: ReactNode;
  level?: GlassLevel;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  blur?: boolean;
}) {
  const { palette } = useTheme();
  const material = materialStyle(level, palette);
  const reducedTransparency = useReducedTransparency();
  const useBlur = blur && !reducedTransparency;

  return (
    <View style={[styles.glassSurface, material.container, reducedTransparency ? material.opaqueContainer : undefined, style]}>
      {useBlur ? (
        <BlurView pointerEvents="none" intensity={material.blurIntensity} tint={palette.mode} style={StyleSheet.absoluteFill} />
      ) : null}
      {!reducedTransparency ? (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={material.gradient}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[styles.glassHighlight, { backgroundColor: palette.highlight }]} />
        </>
      ) : null}
      <View style={[styles.glassContent, contentStyle]}>{children}</View>
    </View>
  );
}

export function Card({
  children,
  tone = "surface",
  style,
}: {
  children: ReactNode;
  tone?: "surface" | "soft" | "accent" | "insight";
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const toneStyle = cardToneStyle(tone, palette);

  return (
    <GlassSurface level="content" style={[styles.card, toneStyle, style]}>
      {children}
    </GlassSurface>
  );
}

export function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
      {meta ? <Text numberOfLines={1} style={[styles.sectionMeta, { color: palette.muted }]}>{meta}</Text> : null}
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
  const { palette } = useTheme();
  const toneStyle = toneStyleFor(tone, palette);

  return (
    <GlassSurface level="utility" blur={false} style={[styles.statusPill, toneStyle.container, style]}>
      <Text numberOfLines={1} style={[styles.statusPillText, toneStyle.text]}>{label}</Text>
    </GlassSurface>
  );
}

export function ConfidenceBadge({
  label,
  confidence,
}: {
  label?: string;
  confidence: "verified" | "high" | "medium" | "low";
}) {
  const tone: Tone = confidence === "low" || confidence === "medium" ? "warning" : "success";
  const display = label ?? (confidence === "verified" ? "Verified" : `${confidence} confidence`);
  return <StatusPill label={display} tone={tone} />;
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
  const { palette } = useTheme();
  const toneStyle = toneStyleFor(tone, palette);

  return (
    <View style={[styles.sourceBadge, toneStyle.container, style]}>
      <Text numberOfLines={1} style={[styles.sourceBadgeText, toneStyle.text]}>{label}</Text>
    </View>
  );
}

export function formatMacroValue(value: string | number, suffix?: string) {
  if (!suffix) {
    return String(value);
  }

  // Keep compact units attached while preserving readable word-based suffixes.
  return suffix === "g" || suffix.startsWith("/") ? `${value}${suffix}` : `${value} ${suffix}`;
}

export function MacroStatTile({
  label,
  value,
  suffix,
  tone = "neutral",
  style,
  valueStyle,
  valueMaxFontSizeMultiplier,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
  valueMaxFontSizeMultiplier?: number;
}) {
  const { palette } = useTheme();
  return (
    <GlassSurface level="utility" blur={false} style={[styles.macroTile, macroTileToneStyle(tone, palette), style]}>
      <Text
        maxFontSizeMultiplier={valueMaxFontSizeMultiplier}
        numberOfLines={1}
        style={[styles.macroValue, macroToneStyles[tone], valueStyle]}
      >
        {formatMacroValue(value, suffix)}
      </Text>
      <Text style={[styles.macroLabel, { color: palette.muted }]}>{label}</Text>
    </GlassSurface>
  );
}

export function QuantityStepper({
  label,
  value,
  step,
  onValueChange,
  min = 0,
  max,
  unit = "grams",
}: {
  label: string;
  value: number;
  step: number;
  onValueChange: (nextValue: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const { palette } = useTheme();
  const normalizedValue = Number.isFinite(value) ? value : min;
  const decreaseDisabled = normalizedValue <= min;
  const increaseDisabled = max !== undefined && normalizedValue >= max;

  function adjust(direction: -1 | 1) {
    const rawNextValue = normalizedValue + step * direction;
    const boundedValue = Math.min(Math.max(rawNextValue, min), max ?? Number.POSITIVE_INFINITY);
    const nextValue = Math.round(boundedValue * 100) / 100;

    if (nextValue === normalizedValue) {
      return;
    }

    void Haptics.selectionAsync().catch(() => undefined);
    onValueChange(nextValue);
  }

  return (
    <View style={[styles.quantityStepper, { backgroundColor: palette.controlSurface, borderColor: palette.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label} by ${formatStepperValue(step)} ${unit}`}
        accessibilityState={{ disabled: decreaseDisabled }}
        disabled={decreaseDisabled}
        onPress={() => adjust(-1)}
        style={({ pressed }) => [
          styles.quantityStepperButton,
          { backgroundColor: palette.surfaceAlt },
          decreaseDisabled ? styles.disabled : undefined,
          pressed && !decreaseDisabled ? styles.pressed : undefined,
        ]}
      >
        <Ionicons name="remove" size={18} color={palette.ink} />
      </Pressable>
      <Text style={[styles.quantityStepperValue, { color: palette.ink }]}>
        {formatStepperValue(normalizedValue)} {unit}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label} by ${formatStepperValue(step)} ${unit}`}
        accessibilityState={{ disabled: increaseDisabled }}
        disabled={increaseDisabled}
        onPress={() => adjust(1)}
        style={({ pressed }) => [
          styles.quantityStepperButton,
          { backgroundColor: palette.surfaceAlt },
          increaseDisabled ? styles.disabled : undefined,
          pressed && !increaseDisabled ? styles.pressed : undefined,
        ]}
      >
        <Ionicons name="add" size={18} color={palette.ink} />
      </Pressable>
    </View>
  );
}

export function MacroProgressBar({
  label,
  value,
  target,
  tone = "success",
  onPress,
  selected = false,
}: {
  label: string;
  value: number;
  target: number;
  tone?: Extract<Tone, "success" | "protein" | "carbs" | "fat" | "fiber">;
  onPress?: () => void;
  selected?: boolean;
}) {
  const { palette } = useTheme();
  const progress = target > 0 ? Math.min(Math.max(value / target, 0), 1) : 0;
  const color = progressToneColors[tone];

  const content = (
    <>
      <View style={styles.progressHeader}>
        <Text style={[styles.progressLabel, { color: palette.ink }]}>{label}</Text>
        <Text style={[styles.progressValue, { color: palette.muted }]}>{Math.round(value)} / {Math.round(target)}g</Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: palette.progressTrack }]}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: color }]} />
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${Math.round(value)} of ${Math.round(target)} grams`}
        accessibilityHint={`Show ${label.toLowerCase()} progress details`}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.progressItem,
          selected ? [styles.progressItemSelected, { backgroundColor: palette.mode === "dark" ? "rgba(45, 88, 58, 0.62)" : "rgba(28, 116, 83, 0.08)" }] : undefined,
          pressed ? styles.progressItemPressed : undefined,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={`${label}: ${Math.round(value)} of ${Math.round(target)} grams`} style={styles.progressItem}>
      {content}
    </View>
  );
}

export function InlineNotice({
  title,
  body,
  tone = "neutral",
  actions,
  accessibilityLabel,
}: {
  title: string;
  body: string;
  tone?: Tone;
  actions?: InlineNoticeAction[];
  accessibilityLabel?: string;
}) {
  const { palette } = useTheme();
  const toneStyle = toneStyleFor(tone, palette);

  return (
    <View accessibilityRole="alert" accessibilityLabel={accessibilityLabel} style={[styles.notice, toneStyle.container]}>
      <Text style={[styles.noticeTitle, toneStyle.text]}>{title}</Text>
      <Text style={[styles.noticeBody, { color: palette.muted }]}>{body}</Text>
      {actions?.length ? (
        <View style={styles.noticeActions}>
          {actions.map((action) => (
            <ActionButton
              key={action.label}
              label={action.label}
              variant={action.variant ?? "secondary"}
              onPress={action.onPress}
              disabled={action.disabled}
              style={styles.noticeActionButton}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ErrorState({
  title = "We couldn't load this right now",
  body,
  onRetry,
}: {
  title?: string;
  body: string;
  onRetry?: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Card tone="soft" style={styles.stateCard}>
      <View style={styles.stateIcon}><Ionicons color={colors.coral} name="cloud-offline-outline" size={22} /></View>
      <View style={styles.stateCopy}>
        <Text style={[styles.stateTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.stateBody, { color: palette.muted }]}>{body}</Text>
      </View>
      {onRetry ? <ActionButton label="Try again" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  icon = "sparkles-outline",
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const { palette } = useTheme();
  return (
    <Card tone="soft" style={styles.emptyState}>
      <View style={styles.emptyIcon}><Ionicons color={colors.green} name={icon} size={26} /></View>
      <Text style={[styles.emptyTitle, { color: palette.ink }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: palette.muted }]}>{body}</Text>
      {actionLabel && onAction ? <ActionButton label={actionLabel} onPress={onAction} /> : null}
    </Card>
  );
}

export function SkeletonBlock({
  height,
  width = "100%",
  style,
  accessibilityLabel,
}: {
  height: number;
  width?: number | `${number}%`;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { palette } = useTheme();

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? "yes" : "no-hide-descendants"}
      style={[
        styles.skeletonBlock,
        {
          width,
          height,
          backgroundColor: palette.mode === "dark" ? "rgba(235, 245, 235, 0.12)" : "rgba(20, 37, 29, 0.10)",
        },
        style,
      ]}
    />
  );
}

export function GlassIconButton({
  icon,
  label,
  onPress,
  tone = "light",
  disabled = false,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: "light" | "dark";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={8}
      onPress={() => {
        playHaptic("selection");
        onPress?.();
      }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        tone === "dark" ? styles.iconButtonDark : [styles.iconButtonLight, { backgroundColor: palette.utilityGlass, borderColor: palette.border }],
        disabled ? styles.disabled : undefined,
        pressed && !disabled ? styles.pressed : undefined,
        style,
      ]}
    >
      <Ionicons name={icon} size={20} color={tone === "dark" ? palette.iconOnDark : palette.ink} />
    </Pressable>
  );
}

export function ActionButton({
  label,
  variant = "primary",
  disabled,
  loading,
  onPress,
  style,
  accessibilityHint,
  haptic = "light",
}: ActionButtonProps) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        styles.actionButton,
        actionButtonStyle(variant, palette),
        disabled || loading ? styles.disabled : undefined,
        pressed && !disabled && !loading ? styles.pressed : undefined,
        style,
      ]}
      onPress={(event) => {
        playHaptic(haptic);
        onPress?.(event);
      }}
      disabled={disabled || loading}
    >
      <Text style={[styles.actionButtonText, actionButtonTextStyle(variant, palette)]}>{loading ? "Working…" : label}</Text>
    </Pressable>
  );
}

export const GlassButton = ActionButton;

export function SwipeActionRow({
  children,
  actionLabel,
  actionText = "Delete",
  onAction,
  disabled = false,
  accessibilityHint,
  style,
}: {
  children: ReactNode;
  actionLabel: string;
  actionText?: string;
  onAction: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const translationX = useRef(new Animated.Value(0)).current;
  const revealedRef = useRef(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const settle = (nextRevealed: boolean) => {
    const destination = nextRevealed ? -swipeRevealDistance : 0;
    if (nextRevealed && !revealedRef.current && !reducedMotionRef.current) {
      void Haptics.selectionAsync().catch(() => undefined);
    }
    revealedRef.current = nextRevealed;
    setRevealed(nextRevealed);

    if (reducedMotionRef.current) {
      translationX.setValue(destination);
      return;
    }

    Animated.spring(translationX, {
      toValue: destination,
      useNativeDriver: true,
      speed: 22,
      bounciness: 0,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        translationX.setValue(Math.min(0, Math.max(-swipeRevealDistance, gesture.dx)));
      },
      onPanResponderRelease: (_, gesture) => {
        const nextTranslation = Math.min(0, Math.max(-swipeRevealDistance, gesture.dx));
        settle(shouldRevealSwipeAction(nextTranslation, gesture.vx));
      },
      onPanResponderTerminate: () => settle(false),
    })
  ).current;

  return (
    <View style={[styles.swipeActionRow, style]}>
      <View
        accessible={revealed}
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? "yes" : "no-hide-descendants"}
        style={styles.swipeActionBackground}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => {
            settle(false);
            onAction();
          }}
          style={[styles.swipeActionButton, { backgroundColor: palette.mode === "dark" ? "#B75447" : colors.coral }, disabled ? styles.disabled : undefined]}
        >
          <Ionicons name="trash-outline" size={20} color={colors.white} />
          <Text style={styles.swipeActionText}>{actionText}</Text>
        </Pressable>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        accessibilityHint={accessibilityHint ?? "Swipe left to reveal a delete action. A standard delete control is also available."}
        style={{ transform: [{ translateX: translationX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function useReducedTransparency() {
  const [reducedTransparency, setReducedTransparency] = useState(false);

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceTransparencyChanged",
      setReducedTransparency
    );

    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (active) setReducedTransparency(enabled);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedTransparency;
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReducedMotion(enabled);
    }).catch(() => undefined);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function sourceLabel(provider?: string) {
  if (!provider) {
    return "Source matched";
  }

  const normalized = provider.replaceAll("_", " ");
  return normalized === "usda" ? "USDA matched" : `${normalized} matched`;
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.xxl, paddingBottom: 150 },
  staticContent: { flex: 1, padding: spacing.xxl, paddingBottom: 150 },
  contentFrame: { width: "100%", maxWidth: 720, alignSelf: "center", gap: spacing.xl },
  atmosphereOrb: { position: "absolute", borderRadius: radii.pill, opacity: 0.56 },
  atmosphereOrbTop: { width: 260, height: 260, top: -122, right: -104 },
  atmosphereOrbBottom: { width: 250, height: 250, bottom: -142, left: -126 },
  glassSurface: { overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  glassContent: { position: "relative" },
  glassHighlight: { position: "absolute", top: 0, left: 12, right: 12, height: 1 },
  card: { borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, ...elevations.content },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  sectionTitle: { ...typography.heading },
  sectionMeta: { ...typography.caption, flexShrink: 1, textAlign: "right" },
  statusPill: { minHeight: 32, maxWidth: 150, alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  statusPillText: { ...typography.caption },
  sourceBadge: { alignSelf: "flex-start", maxWidth: 174, overflow: "hidden", borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  sourceBadgeText: { ...typography.caption },
  macroTile: { flex: 1, minWidth: 0, minHeight: 98, borderRadius: radii.md, padding: spacing.md, justifyContent: "flex-start", gap: spacing.xs },
  macroValue: { ...typography.stat, flexShrink: 1, minWidth: 0 },
  macroLabel: { ...typography.caption },
  quantityStepper: {
    minHeight: 48,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xs,
  },
  quantityStepperButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  quantityStepperValue: {
    minWidth: 74,
    ...typography.caption,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  progressItem: { gap: spacing.xs },
  progressItemSelected: { borderRadius: radii.sm, padding: spacing.xs, marginHorizontal: -spacing.xs },
  progressItemPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  progressHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  progressLabel: { ...typography.caption },
  progressValue: { ...typography.caption, fontVariant: ["tabular-nums"] },
  progressTrack: { height: 8, overflow: "hidden", borderRadius: radii.pill },
  progressFill: { height: "100%", minWidth: 3, borderRadius: radii.pill },
  notice: { borderRadius: radii.md, padding: spacing.lg, gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(20, 37, 29, 0.07)" },
  noticeTitle: { ...typography.heading },
  noticeBody: { ...typography.body },
  noticeActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.sm },
  noticeActionButton: { flexGrow: 1 },
  actionButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.lg },
  actionButtonText: { ...typography.button },
  swipeActionRow: { overflow: "hidden", borderRadius: radii.lg },
  swipeActionBackground: { ...StyleSheet.absoluteFillObject, alignItems: "flex-end" },
  swipeActionButton: { width: swipeRevealDistance, minHeight: 88, alignItems: "center", justifyContent: "center", gap: spacing.xxs },
  swipeActionText: { ...typography.caption, color: colors.white, fontWeight: "700" },
  disabled: { opacity: 0.52 },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  iconButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
  iconButtonLight: { backgroundColor: glass.utility, borderColor: glass.border },
  iconButtonDark: { backgroundColor: "rgba(11, 22, 16, 0.56)", borderColor: "rgba(255, 255, 255, 0.24)" },
  stateCard: { flexDirection: "row", alignItems: "flex-start" },
  stateIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.coralSoft },
  stateCopy: { flex: 1, gap: spacing.xs },
  stateTitle: { ...typography.heading },
  stateBody: { ...typography.body },
  emptyState: { alignItems: "center", textAlign: "center", paddingVertical: spacing.xxl },
  emptyIcon: { width: 58, height: 58, alignItems: "center", justifyContent: "center", borderRadius: radii.lg, backgroundColor: colors.limeSoft },
  emptyTitle: { ...typography.heading, textAlign: "center" },
  emptyBody: { ...typography.body, textAlign: "center" },
  skeletonBlock: { overflow: "hidden", borderRadius: radii.sm },
});

const macroToneStyles: Record<Tone, TextStyle> = {
  neutral: { color: colors.ink }, success: { color: colors.green }, warning: { color: colors.carbs }, danger: { color: colors.coral }, protein: { color: colors.protein }, carbs: { color: colors.carbs }, fat: { color: colors.fat }, fiber: { color: colors.fiber }, insight: { color: colors.insight },
};

const progressToneColors = { success: colors.green, protein: colors.protein, carbs: colors.carbs, fat: colors.fat, fiber: colors.fiber };

function formatStepperValue(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function materialStyle(level: GlassLevel, palette: ThemePalette) {
  const translucentGradient = palette.mode === "dark"
    ? ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.025)", "rgba(255,255,255,0.07)"] as [string, string, string]
    : ["rgba(255,255,255,0.54)", "rgba(255,255,255,0.12)", "rgba(255,255,255,0.30)"] as [string, string, string];
  const values = {
    navigation: { background: palette.navigationGlass, opaque: palette.surface, blur: glass.blur.navigation, radius: radii.pill, elevation: elevations.navigation },
    content: { background: palette.contentGlass, opaque: palette.surface, blur: glass.blur.content, radius: undefined, elevation: elevations.content },
    utility: { background: palette.utilityGlass, opaque: palette.surfaceAlt, blur: glass.blur.utility, radius: undefined, elevation: undefined },
  }[level];

  return {
    container: { backgroundColor: values.background, borderColor: palette.border, ...(values.radius ? { borderRadius: values.radius } : {}), ...(values.elevation ?? {}) } as ViewStyle,
    opaqueContainer: { backgroundColor: values.opaque } as ViewStyle,
    blurIntensity: values.blur,
    gradient: translucentGradient,
  };
}

function cardToneStyle(tone: "surface" | "soft" | "accent" | "insight", palette: ThemePalette): ViewStyle {
  return { backgroundColor: tone === "surface" ? palette.contentGlass : tone === "soft" ? palette.cardSoft : tone === "accent" ? palette.cardAccent : palette.cardInsight };
}

function actionButtonStyle(variant: NonNullable<ActionButtonProps["variant"]>, palette: ThemePalette): ViewStyle {
  if (variant === "primary") return { backgroundColor: colors.green, ...elevations.floating };
  if (variant === "danger") return { backgroundColor: palette.dangerSurface };
  if (variant === "secondary") return { backgroundColor: palette.controlSurfaceMuted };
  if (variant === "quiet") return { backgroundColor: palette.controlSurface };
  return { backgroundColor: "transparent" };
}

function actionButtonTextStyle(variant: NonNullable<ActionButtonProps["variant"]>, palette: ThemePalette): TextStyle {
  if (variant === "primary") return { color: palette.onPrimary };
  if (variant === "danger") return { color: palette.dangerText };
  if (variant === "ghost") return { color: colors.green };
  return { color: palette.ink };
}

function macroTileToneStyle(tone: Tone, palette: ThemePalette): ViewStyle {
  if (tone === "neutral") return { backgroundColor: palette.controlSurface };
  if (tone === "success") return { backgroundColor: palette.mode === "dark" ? "rgba(41, 90, 62, 0.78)" : "rgba(225,241,218,0.72)" };
  if (tone === "warning" || tone === "carbs") return { backgroundColor: palette.mode === "dark" ? "rgba(93, 69, 22, 0.82)" : colors.carbsSoft };
  if (tone === "danger" || tone === "fat") return { backgroundColor: palette.mode === "dark" ? "rgba(100, 49, 57, 0.82)" : colors.fatSoft };
  if (tone === "protein") return { backgroundColor: palette.mode === "dark" ? "rgba(70, 50, 104, 0.82)" : colors.proteinSoft };
  if (tone === "fiber") return { backgroundColor: palette.mode === "dark" ? "rgba(45, 88, 58, 0.82)" : colors.limeSoft };
  return { backgroundColor: palette.mode === "dark" ? "rgba(47, 70, 99, 0.82)" : colors.insightSoft };
}

function toneStyleFor(tone: Tone, palette: ThemePalette): { container: ViewStyle; text: TextStyle } {
  const colorsByTone: Record<Tone, { text: string; background: string }> = {
    neutral: { text: palette.muted, background: palette.controlSurfaceMuted },
    success: { text: palette.mode === "dark" ? "#8EE0AE" : colors.green, background: palette.mode === "dark" ? "rgba(37, 95, 62, 0.80)" : "rgba(225, 241, 218, 0.92)" },
    warning: { text: palette.warningText, background: palette.mode === "dark" ? "rgba(98, 73, 21, 0.82)" : colors.carbsSoft },
    danger: { text: palette.mode === "dark" ? "#FA9B89" : colors.coral, background: palette.mode === "dark" ? "rgba(100, 49, 57, 0.82)" : colors.coralSoft },
    protein: { text: palette.mode === "dark" ? "#CFB4FF" : colors.protein, background: palette.mode === "dark" ? "rgba(70, 50, 104, 0.82)" : colors.proteinSoft },
    carbs: { text: palette.warningText, background: palette.mode === "dark" ? "rgba(98, 73, 21, 0.82)" : colors.carbsSoft },
    fat: { text: palette.mode === "dark" ? "#F6A1B0" : colors.fat, background: palette.mode === "dark" ? "rgba(100, 49, 57, 0.82)" : colors.fatSoft },
    fiber: { text: palette.mode === "dark" ? "#9DE2B4" : colors.fiber, background: palette.mode === "dark" ? "rgba(45, 88, 58, 0.82)" : colors.limeSoft },
    insight: { text: palette.mode === "dark" ? "#A9C7F0" : colors.insight, background: palette.mode === "dark" ? "rgba(47, 70, 99, 0.82)" : colors.insightSoft },
  };
  const selected = colorsByTone[tone];
  return { container: { backgroundColor: selected.background }, text: { color: selected.text } };
}
