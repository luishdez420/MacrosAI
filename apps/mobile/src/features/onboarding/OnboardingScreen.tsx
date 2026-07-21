import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, elevations, motion, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { ActionButton, GlassSurface, InlineNotice, MacroStatTile, StatusPill } from "../../shared/components/LivingUI";
import { api } from "../../services/api";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { goalDirectionForOnboardingGoal } from "../../shared/domain/onboardingPersonalization";
import {
  defaultOnboardingPreferences,
  dietaryPreferenceLabel,
  dietaryPreferences,
  goalDirectionForPreference,
  goalPreferenceLabel,
  goalPreferences,
  loggingPreferenceLabel,
  loggingPreferences,
  type GoalPreference,
  type DietaryPreference,
  type LoggingPreference,
} from "./onboardingPreferences";
import { createOnboardingGoalSetup } from "./onboardingGoalSetup";
import { completeOnboarding } from "./onboardingStorage";

const steps = [
  {
    icon: "sparkles-outline" as const,
    eyebrow: "A calmer way to log",
    title: "Understand your meals in seconds.",
    body: "Start with a photo, barcode, or a food search. Your daily picture builds one intentional entry at a time.",
  },
  {
    icon: "shield-checkmark-outline" as const,
    eyebrow: "You stay in control",
    title: "AI estimates. You confirm.",
    body: "Photos cannot reveal every ingredient or exact portion. We show sources and confidence, then ask you to review before saving.",
  },
  {
    icon: "flag-outline" as const,
    eyebrow: "Your direction",
    title: "Built around your goals.",
    body: "Whether you are building strength, maintaining, or simply learning your patterns, targets stay adjustable and judgment-free.",
  },
  {
    icon: "speedometer-outline" as const,
    eyebrow: "Optional starting target",
    title: "Start with a target you can review.",
    body: "Share only the measurements you are comfortable using. We will show the assumptions before anything is saved.",
  },
  {
    icon: "leaf-outline" as const,
    eyebrow: "Optional preference",
    title: "Save what fits your eating pattern.",
    body: "Choose any that are useful to you. You can change these later in Profile.",
  },
  {
    icon: "camera-outline" as const,
    eyebrow: "Accuracy preference",
    title: "Use the tools that fit your routine.",
    body: "A kitchen scale and package label can improve precision. Camera analysis is always an editable estimate.",
  },
];

export function OnboardingScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const themed = onboardingThemeStyles(palette);
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState(0);
  const [loggingPreference, setLoggingPreference] = useState<LoggingPreference>(
    defaultOnboardingPreferences.loggingPreference
  );
  const [goalPreference, setGoalPreference] = useState<GoalPreference>(
    defaultOnboardingPreferences.goalPreference
  );
  const [selectedDietaryPreferences, setSelectedDietaryPreferences] = useState<DietaryPreference[]>(
    defaultOnboardingPreferences.dietaryPreferences
  );
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPercent, setBodyFatPercent] = useState("");
  const [useEstimatedGoal, setUseEstimatedGoal] = useState(false);
  const [saving, setSaving] = useState(false);
  const entrance = useRef(new Animated.Value(0)).current;
  const current = steps[step];
  const isFinalStep = step === steps.length - 1;
  const startingGoal = createOnboardingGoalSetup({
    heightCm,
    weightKg,
    bodyFatPercent,
    direction: goalDirectionForOnboardingGoal(goalPreference),
    startsOn: new Date().toISOString().slice(0, 10),
  });
  const shouldAnimate = process.env.NODE_ENV !== "test";
  const StepContainer = shouldAnimate ? Animated.View : View;

  useEffect(() => {
    if (!shouldAnimate) {
      return undefined;
    }

    entrance.setValue(0);
    Animated.timing(entrance, { toValue: 1, duration: motion.reveal, useNativeDriver: true }).start();
  }, [entrance, shouldAnimate, step]);

  async function finish() {
    setSaving(true);
    const initialNutritionGoal = useEstimatedGoal && startingGoal.ok ? startingGoal.goal : undefined;
    await completeOnboarding({
      goalPreference,
      loggingPreference,
      dietaryPreferences: selectedDietaryPreferences,
      initialNutritionGoal,
    });
    // Local completion stays immediate; a later profile load can retry if this preview is offline.
    void Promise.all([
      api.updatePreferences({
        onboardingGoal: goalPreference,
        loggingPreference,
        dietaryPreferences: selectedDietaryPreferences,
        goalDirection: goalDirectionForPreference(goalPreference),
      }),
      ...(initialNutritionGoal ? [api.updateGoal(initialNutritionGoal)] : []),
    ]).catch(() => undefined);
    router.replace("/");
  }

  async function requestCameraPermission() {
    if (!permission?.granted) {
      await requestPermission();
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <LinearGradient colors={[palette.backgroundWarm, palette.background, palette.backgroundDeep]} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[styles.orbTop, { backgroundColor: palette.orbPrimary }]} />
      <View pointerEvents="none" style={[styles.orbBottom, { backgroundColor: palette.orbSecondary }]} />
      <KeyboardAvoidingView style={styles.keyboardAvoider} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        testID="onboarding-scroll"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <Text style={[styles.brand, themed.actionText]}>LIVING NUTRITION</Text>
          <View style={styles.headerActions}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back one onboarding step"
                onPress={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
                style={styles.backButton}
              >
                <Ionicons name="chevron-back" size={16} color={themed.actionText.color} />
                <Text style={[styles.backText, themed.actionText]}>Back</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Skip onboarding" onPress={finish} style={styles.skipButton}>
              <Text style={[styles.skipText, themed.actionText]}>Skip</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.progressRow} accessibilityLabel={`Onboarding step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => <View key={item.title} style={[styles.progressDot, themed.progressTrack, index === step ? styles.progressDotActive : undefined]} />)}
        </View>

        <StepContainer
          style={shouldAnimate
            ? [styles.stepArea, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]
            : styles.stepArea}
        >
          <View style={[styles.heroIcon, themed.controlSurface]}><Ionicons name={current.icon} size={38} color={themed.actionText.color} /></View>
          <Text style={[styles.eyebrow, themed.actionText]}>{current.eyebrow}</Text>
          <Text style={[styles.title, themed.ink]}>{current.title}</Text>
          <Text style={[styles.body, themed.muted]}>{current.body}</Text>

          {step === 2 ? <GoalPreview selectedGoal={goalPreference} onSelectGoal={setGoalPreference} /> : null}
          {step === 3 ? (
            <StartingGoalSetup
              heightCm={heightCm}
              weightKg={weightKg}
              bodyFatPercent={bodyFatPercent}
              result={startingGoal}
              selected={useEstimatedGoal}
              onChangeHeight={(value) => {
                setHeightCm(value);
                setUseEstimatedGoal(false);
              }}
              onChangeWeight={(value) => {
                setWeightKg(value);
                setUseEstimatedGoal(false);
              }}
              onChangeBodyFat={(value) => {
                setBodyFatPercent(value);
                setUseEstimatedGoal(false);
              }}
              onToggleSelected={() => setUseEstimatedGoal((currentValue) => !currentValue)}
            />
          ) : null}
          {step === 4 ? (
            <DietaryPreferencePicker
              selectedPreferences={selectedDietaryPreferences}
              onTogglePreference={(preference) => {
                setSelectedDietaryPreferences((currentPreferences) =>
                  currentPreferences.includes(preference)
                    ? currentPreferences.filter((item) => item !== preference)
                    : [...currentPreferences, preference]
                );
              }}
            />
          ) : null}
          {step === 5 ? (
            <View style={styles.preferenceArea}>
              <Text style={[styles.preferenceLabel, themed.ink]}>I usually rely on</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Preferred logging method" style={styles.chipGrid}>
                {loggingPreferences.map((item) => (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${loggingPreferenceLabel(item)} as my usual logging method`}
                    accessibilityState={{ selected: loggingPreference === item }}
                    onPress={() => setLoggingPreference(item)}
                    style={[styles.preferenceChip, themed.controlSurface, loggingPreference === item ? styles.preferenceChipSelected : undefined]}
                  >
                    <Text style={[styles.preferenceChipText, { color: loggingPreference === item ? palette.onPrimary : palette.ink }]}>{loggingPreferenceLabel(item)}</Text>
                  </Pressable>
                ))}
              </View>
              <GlassSurface level="utility" blur={false} style={[styles.permissionPanel, themed.insightSurface]}>
                <View style={styles.permissionCopy}>
                  <Text style={[styles.permissionTitle, themed.ink]}>Camera is optional</Text>
                  <Text style={[styles.permissionText, themed.muted]}>Enable it only when you are ready to scan meals or barcodes.</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={permission?.granted ? "Camera access enabled" : "Enable camera access for future meal and barcode scans"}
                  accessibilityState={{ selected: Boolean(permission?.granted) }}
                  onPress={requestCameraPermission}
                  style={[styles.permissionButton, themed.permissionButton]}
                >
                  <Text style={[styles.permissionButtonText, { color: palette.onPrimary }]}>{permission?.granted ? "Enabled" : "Enable"}</Text>
                </Pressable>
              </GlassSurface>
            </View>
          ) : null}
        </StepContainer>

        <View style={styles.footer}>
          <Text style={[styles.footerHint, themed.muted]}>{isFinalStep ? "You can change portions whenever you log. Nutrition targets stay adjustable in Profile." : "Your meals stay editable after every scan."}</Text>
          <ActionButton
            label={isFinalStep ? "Start tracking" : "Continue"}
            loading={saving}
            onPress={() => isFinalStep ? void finish() : setStep((currentStep) => currentStep + 1)}
          />
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DietaryPreferencePicker({
  selectedPreferences,
  onTogglePreference,
}: {
  selectedPreferences: DietaryPreference[];
  onTogglePreference: (preference: DietaryPreference) => void;
}) {
  const { palette } = useTheme();
  const themed = onboardingThemeStyles(palette);

  return (
    <View style={styles.preferenceArea}>
      <Text style={[styles.preferenceLabel, themed.ink]}>Select any that are helpful</Text>
      <View accessibilityLabel="Dietary preferences" style={styles.chipGrid}>
        {dietaryPreferences.map((preference) => {
          const selected = selectedPreferences.includes(preference);
          const label = dietaryPreferenceLabel(preference);
          return (
            <Pressable
              key={preference}
              accessibilityRole="checkbox"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() => onTogglePreference(preference)}
              style={[styles.preferenceChip, themed.controlSurface, selected ? styles.preferenceChipSelected : undefined]}
            >
              <Text style={[styles.preferenceChipText, { color: selected ? palette.onPrimary : palette.ink }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <GlassSurface level="utility" blur={false} style={[styles.preferenceDisclosure, themed.insightSurface]}>
        <Text style={[styles.permissionText, themed.muted]}>
          Saved for your reference only. These selections do not filter food matches, verify ingredients or allergens, or determine medical suitability.
        </Text>
      </GlassSurface>
    </View>
  );
}

function StartingGoalSetup({
  heightCm,
  weightKg,
  bodyFatPercent,
  result,
  selected,
  onChangeHeight,
  onChangeWeight,
  onChangeBodyFat,
  onToggleSelected,
}: {
  heightCm: string;
  weightKg: string;
  bodyFatPercent: string;
  result: ReturnType<typeof createOnboardingGoalSetup>;
  selected: boolean;
  onChangeHeight: (value: string) => void;
  onChangeWeight: (value: string) => void;
  onChangeBodyFat: (value: string) => void;
  onToggleSelected: () => void;
}) {
  const { palette } = useTheme();
  const themed = onboardingThemeStyles(palette);

  return (
    <View style={styles.startingGoalArea}>
      <View style={styles.startingGoalInputs}>
        <TextInput
          accessibilityLabel="Height in centimeters for an estimated daily target"
          style={[styles.targetInput, themed.input]}
          value={heightCm}
          onChangeText={onChangeHeight}
          keyboardType="decimal-pad"
          placeholder="Height cm"
          placeholderTextColor={palette.muted}
        />
        <TextInput
          accessibilityLabel="Weight in kilograms for an estimated daily target"
          style={[styles.targetInput, themed.input]}
          value={weightKg}
          onChangeText={onChangeWeight}
          keyboardType="decimal-pad"
          placeholder="Weight kg"
          placeholderTextColor={palette.muted}
        />
      </View>
      <TextInput
        accessibilityLabel="Optional body fat percentage for an estimated daily target"
        style={[styles.targetInput, themed.input]}
        value={bodyFatPercent}
        onChangeText={onChangeBodyFat}
        keyboardType="decimal-pad"
        placeholder="Body fat percentage (optional)"
        placeholderTextColor={palette.muted}
      />
      {!result.ok && result.hasEnteredMeasurements ? (
        <InlineNotice title="Add a valid height and weight" body="Use 120–230 cm and 30–250 kg to preview an estimate. Body fat, if entered, must be 5–60%." tone="warning" />
      ) : null}
      {result.ok ? (
        <GlassSurface level="content" blur={false} style={[styles.targetPreview, themed.goalPreview]}>
          <View style={styles.targetPreviewHeader}>
            <View>
              <Text style={[styles.targetPreviewEyebrow, themed.actionText]}>Estimated daily target</Text>
              <Text style={[styles.targetCalories, themed.ink]}>{result.goal.caloriesKcal} kcal</Text>
            </View>
            <StatusPill label="Review first" tone="warning" />
          </View>
          <View style={styles.targetMacroRow}>
            <MacroStatTile label="Protein" value={result.goal.proteinGrams} suffix="g" tone="protein" />
            <MacroStatTile label="Carbs" value={result.goal.carbohydrateGrams} suffix="g" tone="carbs" />
            <MacroStatTile label="Fat" value={result.goal.fatGrams} suffix="g" tone="fat" />
          </View>
          <Text style={[styles.targetExplanation, themed.muted]}>{result.explanation}</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Use this estimated daily target"
            accessibilityState={{ checked: selected }}
            onPress={onToggleSelected}
            style={[styles.targetChoice, themed.controlSurface, selected ? styles.targetChoiceSelected : undefined]}
          >
            <View style={[styles.targetChoiceIndicator, selected ? styles.targetChoiceIndicatorSelected : undefined]}>
              {selected ? <Ionicons name="checkmark" size={16} color={palette.onPrimary} /> : null}
            </View>
            <Text style={[styles.targetChoiceText, themed.ink]}>Use this estimate as my starting target</Text>
          </Pressable>
        </GlassSurface>
      ) : (
        <Text style={[styles.targetHint, themed.muted]}>Optional. Leave this blank to choose a target later in Profile.</Text>
      )}
    </View>
  );
}

function GoalPreview({
  selectedGoal,
  onSelectGoal,
}: {
  selectedGoal: GoalPreference;
  onSelectGoal: (goal: GoalPreference) => void;
}) {
  const { palette } = useTheme();
  const themed = onboardingThemeStyles(palette);

  return (
    <View style={[styles.goalPreview, themed.goalPreview]}>
      <StatusPill label="Adjustable anytime" tone="success" />
      <View style={styles.goalRows}>
        {goalPreferences.map((goal) => (
          <GoalRow
            key={goal}
            icon={goalIcon(goal)}
            label={goalPreferenceLabel(goal)}
            selected={goal === selectedGoal}
            onPress={() => onSelectGoal(goal)}
          />
        ))}
      </View>
    </View>
  );
}

function GoalRow({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const themed = onboardingThemeStyles(palette);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Use ${label} as my nutrition direction`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.goalRow, selected ? themed.goalRowSelected : undefined]}
    >
      <View style={[styles.goalRowIcon, themed.subsurface]}><Ionicons name={icon} size={18} color={themed.actionText.color} /></View>
      <Text style={[styles.goalRowText, themed.ink]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={18} color={themed.actionText.color} /> : null}
    </Pressable>
  );
}

function goalIcon(goal: GoalPreference): keyof typeof Ionicons.glyphMap {
  const icons: Record<GoalPreference, keyof typeof Ionicons.glyphMap> = {
    build_strength: "barbell-outline",
    maintain_rhythm: "leaf-outline",
    improve_nutrition: "nutrition-outline",
    lose_gradually: "trending-down-outline",
    support_performance: "flash-outline",
    track_macros: "analytics-outline",
  };

  return icons[goal];
}

function onboardingThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    controlSurface: { backgroundColor: palette.controlSurface },
    subsurface: { backgroundColor: palette.surfaceAlt },
    progressTrack: { backgroundColor: palette.progressTrack },
    goalPreview: { backgroundColor: palette.contentGlass, borderColor: palette.border },
    goalRowSelected: { backgroundColor: palette.controlSurfaceMuted },
    insightSurface: { backgroundColor: palette.cardInsight },
    permissionButton: { backgroundColor: palette.mode === "dark" ? palette.surfaceMuted : colors.insight },
    input: {
      backgroundColor: palette.controlSurface,
      borderColor: palette.border,
      color: palette.ink,
    },
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  keyboardAvoider: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl, justifyContent: "space-between", gap: spacing.xxl },
  orbTop: { position: "absolute", top: -116, right: -98, width: 260, height: 260, borderRadius: radii.pill, backgroundColor: colors.limeSoft, opacity: 0.75 },
  orbBottom: { position: "absolute", bottom: -130, left: -100, width: 250, height: 250, borderRadius: radii.pill, backgroundColor: colors.insightSoft, opacity: 0.68 },
  topRow: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  brand: { ...typography.eyebrow, color: colors.greenDeep },
  backButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 2, justifyContent: "center", paddingHorizontal: spacing.xs },
  backText: { ...typography.button, color: colors.green },
  skipButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.xs },
  skipText: { ...typography.button, color: colors.green },
  progressRow: { flexDirection: "row", gap: spacing.xs, marginTop: -spacing.xl },
  progressDot: { flex: 1, height: 5, borderRadius: radii.pill, backgroundColor: "rgba(20, 37, 29, 0.10)" },
  progressDotActive: { backgroundColor: colors.green },
  stepArea: { flex: 1, justifyContent: "center", gap: spacing.md },
  heroIcon: { width: 76, height: 76, alignItems: "center", justifyContent: "center", borderRadius: radii.xl, backgroundColor: "rgba(255,255,255,0.72)", ...elevations.content },
  eyebrow: { ...typography.eyebrow, color: colors.green },
  title: { ...typography.displayLarge, maxWidth: 360, color: colors.ink },
  body: { ...typography.body, maxWidth: 360, color: colors.muted },
  goalPreview: { marginTop: spacing.md, gap: spacing.md, borderRadius: radii.lg, padding: spacing.lg, backgroundColor: "rgba(255,255,255,0.68)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.82)" },
  goalRows: { gap: spacing.sm },
  goalRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, paddingHorizontal: spacing.xs },
  goalRowSelected: { backgroundColor: "rgba(230,242,201,0.68)" },
  goalRowIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radii.sm, backgroundColor: colors.limeSoft },
  goalRowText: { ...typography.caption, flex: 1, color: colors.ink },
  startingGoalArea: { marginTop: spacing.md, gap: spacing.sm },
  startingGoalInputs: { flexDirection: "row", gap: spacing.sm },
  targetInput: { flex: 1, minHeight: 46, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.md, color: colors.ink },
  targetPreview: { gap: spacing.md, borderRadius: radii.lg, padding: spacing.md },
  targetPreviewHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  targetPreviewEyebrow: { ...typography.eyebrow, color: colors.greenDeep },
  targetCalories: { ...typography.display, color: colors.ink },
  targetMacroRow: { flexDirection: "row", gap: spacing.sm },
  targetExplanation: { ...typography.caption, color: colors.muted },
  targetChoice: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, padding: spacing.sm },
  targetChoiceSelected: { backgroundColor: colors.limeSoft },
  targetChoiceIndicator: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.green },
  targetChoiceIndicatorSelected: { backgroundColor: colors.green },
  targetChoiceText: { ...typography.caption, flex: 1, color: colors.ink },
  targetHint: { ...typography.caption, color: colors.muted },
  preferenceArea: { marginTop: spacing.md, gap: spacing.md },
  preferenceLabel: { ...typography.caption, color: colors.ink },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  preferenceChip: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: "rgba(255,255,255,0.60)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(20,37,29,0.10)" },
  preferenceChipSelected: { backgroundColor: colors.green, borderColor: colors.green },
  preferenceChipText: { ...typography.caption, color: colors.ink },
  preferenceChipTextSelected: { color: colors.white },
  permissionPanel: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.md, padding: spacing.md, backgroundColor: "rgba(231,240,247,0.74)" },
  preferenceDisclosure: { borderRadius: radii.md, padding: spacing.md },
  permissionCopy: { flex: 1, gap: 2 },
  permissionTitle: { ...typography.caption, color: colors.ink },
  permissionText: { ...typography.caption, color: colors.muted },
  permissionButton: { minHeight: 44, justifyContent: "center", borderRadius: radii.pill, paddingHorizontal: spacing.md, backgroundColor: colors.insight },
  permissionButtonText: { ...typography.caption, color: colors.white },
  footer: { gap: spacing.sm },
  footerHint: { ...typography.caption, color: colors.muted, textAlign: "center" },
});
