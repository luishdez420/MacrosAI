import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import type { FoodSearchResult, MealCreate } from "@living-nutrition/shared-types";
import { calculateConsumedNutrients, roundNutrientsForDisplay } from "@living-nutrition/validation";
import { env } from "../../config/env";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal } from "../../services/offlineMealQueue";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import { qualityFlagDisplay } from "../food-detail/foodDetailPresentation";
import {
  createMealFromFood,
  gramsForPortion,
  getServingGramWeight,
  parsePositiveNumber,
  portionAmountForGrams,
  portionInputLabel,
  portionLabel,
  type PortionMode,
  roundMacro,
} from "../food-logging/foodLogging";
import {
  barcodeNoMatchMessage,
  captionForStatus,
  normalizeBarcode,
  shouldIgnoreBarcodeScan,
  type BarcodeLookupStatus,
} from "./barcodePresentation";
import { createMealActionScope, mealCreateIdempotencyKey } from "../../shared/domain/mealIdempotency";
import { presentApiError } from "../../shared/domain/apiErrorPresentation";
import { canQueueConfirmedMeal } from "../../shared/domain/offlineMealSync";
import { blocksFoodLogging, foodQualityDisplay } from "../../shared/domain/foodQuality";

const supportedBarcodeTypes: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "code128"];

export function BarcodeScannerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = barcodeThemeStyles(palette);
  const [permission, requestPermission] = useCameraPermissions();
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scannerPaused, setScannerPaused] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<BarcodeLookupStatus>("idle");
  const [lookupMessage, setLookupMessage] = useState<string | undefined>(undefined);
  const [saveNotice, setSaveNotice] = useState<string | undefined>(undefined);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | undefined>(undefined);
  const [portionMode, setPortionMode] = useState<PortionMode>("servings");
  const [amount, setAmount] = useState("1");
  const [mealSaved, setMealSaved] = useState(false);
  const lastScanRef = useRef({ barcode: "", scannedAt: 0 });
  const barcodeInputRef = useRef<TextInput>(null);
  const mealActionScope = useRef(createMealActionScope("barcode")).current;
  const servingGramWeight = selectedFood ? getServingGramWeight(selectedFood) : undefined;
  const grams = gramsForPortion(portionMode, amount, servingGramWeight);
  const nutrients = selectedFood
    ? calculateConsumedNutrients(selectedFood.nutrientsPer100g, grams)
    : null;
  const displayNutrients = nutrients ? roundNutrientsForDisplay(nutrients) : null;
  const lookupMutation = useMutation({
    mutationFn: (barcode: string) => api.getFoodByBarcode(barcode),
    onSuccess: (response, barcode) => {
      const food = response.items[0];

      if (!food) {
        setBarcodeInput(barcode);
        setSelectedFood(undefined);
        setLookupStatus("no_match");
        setLookupMessage(barcodeNoMatchMessage(barcode));
        setScannerPaused(true);
        return;
      }

      setBarcodeInput(barcode);
      setLookupStatus("matched");
      setLookupMessage(undefined);
      setScannerPaused(true);
      selectFood(food);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: (error) => {
      setSelectedFood(undefined);
      setLookupStatus("error");
      setLookupMessage(
        presentApiError(error, "We couldn't look up this barcode right now. Try again in a moment.").body
      );
      setScannerPaused(true);
    },
  });
  const logMutation = useMutation({
    mutationFn: ({ meal, idempotencyKey }: { meal: MealCreate; idempotencyKey: string }) =>
      api.createMeal(meal, { idempotencyKey }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      setMealSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: async (error, variables) => {
      if (canQueueConfirmedMeal(error)) {
        const ownerId = await getStoredUserId();
        if (ownerId) {
          try {
            await queueConfirmedMeal(ownerId, variables.meal, variables.idempotencyKey);
            await queryClient.invalidateQueries({ queryKey: ["offline-meal-queue"] });
            setSaveNotice("We could not reach Living Nutrition, so this confirmed packaged food is saved on this device and waiting for you to sync it from Today.");
            return;
          } catch {
            // Use the normal retry message if device storage is unavailable.
          }
        }
      }

      setLookupStatus("error");
      setLookupMessage(
        presentApiError(error, "We couldn't save this packaged food right now. Try again in a moment.").body
      );
    },
  });

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    const barcode = normalizeBarcode(result.data);

    if (!barcode || scannerPaused || lookupMutation.isPending) {
      return;
    }

    const now = Date.now();
    if (shouldIgnoreBarcodeScan({
      barcode,
      scannerPaused,
      lookupPending: lookupMutation.isPending,
      lastScan: lastScanRef.current,
      now,
    })) {
      return;
    }

    lastScanRef.current = { barcode, scannedAt: now };
    setScannerPaused(true);
    setLookupStatus("looking_up");
    setLookupMessage(undefined);
    lookupMutation.mutate(barcode);
  }

  function lookupTypedBarcode() {
    const barcode = normalizeBarcode(barcodeInput);

    if (!barcode) {
      setLookupStatus("error");
      setLookupMessage("Type the number printed below the package barcode, then tap Find.");
      setScannerPaused(true);
      return;
    }

    Keyboard.dismiss();
    setBarcodeInput(barcode);
    lastScanRef.current = { barcode, scannedAt: Date.now() };
    setScannerPaused(true);
    setLookupStatus("looking_up");
    setLookupMessage(undefined);
    lookupMutation.mutate(barcode);
  }

  function selectFood(food: FoodSearchResult) {
    setSelectedFood(food);

    if (getServingGramWeight(food)) {
      setPortionMode("servings");
      setAmount("1");
      return;
    }

    setPortionMode("grams");
    setAmount("100");
  }

  function resetScan() {
    setSelectedFood(undefined);
    setLookupStatus("scanning");
    setLookupMessage(undefined);
    lastScanRef.current = { barcode: "", scannedAt: 0 };
    setScannerPaused(false);
  }

  function focusBarcodeEntry() {
    setScannerPaused(true);
    setLookupMessage(undefined);
    barcodeInputRef.current?.focus();
  }

  function logBarcodeMeal() {
    if (!selectedFood || !nutrients || grams <= 0) {
      setLookupStatus("error");
      setLookupMessage("Enter servings, ounces, or grams greater than 0 before logging.");
      return;
    }

    if (blocksFoodLogging(selectedFood)) {
      setLookupStatus("error");
      setLookupMessage(
        selectedFood.qualityAssessment?.summary ??
          "This barcode record is missing essential per-100g nutrition data. Search for another record before logging."
      );
      return;
    }

    Keyboard.dismiss();
    const confirmedMeal = createMealFromFood({
        food: selectedFood,
        grams,
        servingLabel: portionLabel(portionMode, amount, servingGramWeight),
        nutrients,
        servingQuantity: parsePositiveNumber(amount),
        portionMode,
        source: "barcode",
      });
    setSaveNotice(undefined);
    logMutation.mutate({
      meal: confirmedMeal,
      idempotencyKey: mealCreateIdempotencyKey(mealActionScope, confirmedMeal),
    });
  }

  function changePortionMode(nextMode: PortionMode) {
    if (nextMode === portionMode) {
      return;
    }

    setAmount(portionAmountForGrams(nextMode, grams, servingGramWeight));
    setPortionMode(nextMode);
  }

  if (!permission) {
    return <View style={[styles.screen, { backgroundColor: palette.background }]} />;
  }

  if (!permission.granted && !env.e2eFixtureMode) {
    return (
      <SafeAreaView style={[styles.permissionScreen, { backgroundColor: palette.background }]}>
        <Text style={[styles.title, themed.ink]}>Barcode scanning needs camera access.</Text>
        <Text style={[styles.body, themed.muted]}>
          Packaged foods are most accurate when we can match the barcode to manufacturer label data.
        </Text>
        <ActionButton label="Enable camera" onPress={requestPermission} />
      </SafeAreaView>
    );
  }

  if (mealSaved) {
    return (
      <BarcodeSavedScreen
        onViewToday={() => router.replace("/")}
        onScanAnother={() => router.replace("/barcode")}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={[styles.eyebrow, themed.muted]}>Barcode logging</Text>
                <Text style={[styles.title, themed.ink]}>Scan the package.</Text>
                <Text style={[styles.body, themed.muted]}>
                  We look up packaged foods by barcode, then ask you to confirm servings or grams before saving.
                </Text>
              </View>
              <Link href="/" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Close barcode scanner" style={styles.textButton}>
                  <Text style={[styles.textButtonLabel, themed.actionText]}>Close</Text>
                </Pressable>
              </Link>
            </View>

            <View style={styles.scannerCard}>
              {permission.granted ? (
                <CameraView
                  accessible
                  accessibilityLabel="Barcode camera preview"
                  accessibilityHint={
                    scannerPaused
                      ? "Scanner is paused. Choose Scan again or type the barcode below."
                      : "Point the camera at a package barcode."
                  }
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: supportedBarcodeTypes }}
                  onBarcodeScanned={scannerPaused ? undefined : handleBarcodeScanned}
                />
              ) : (
                <View
                  accessibilityLabel="Barcode camera disabled for automated test fixture"
                  style={styles.e2eCameraPlaceholder}
                >
                  <Text style={styles.e2eCameraPlaceholderText}>Automated test mode uses the barcode number below.</Text>
                </View>
              )}
              <View style={styles.scanFrame} />
              <View style={styles.scanCaption}>
                <Text style={styles.scanCaptionText}>
                  {captionForStatus(lookupStatus, lookupMutation.isPending)}
                </Text>
              </View>
            </View>

            {(lookupStatus === "no_match" || lookupStatus === "error") && lookupMessage ? (
              <InlineNotice
                tone={lookupStatus === "no_match" ? "warning" : "danger"}
                title={lookupStatus === "no_match" ? "No reliable match found" : "Barcode lookup needs attention"}
                body={lookupMessage}
                actions={[
                  { label: "Scan again", onPress: resetScan, variant: "primary" },
                  { label: "Type barcode", onPress: focusBarcodeEntry, variant: "secondary" },
                  {
                    label: "Photograph label",
                    onPress: () => {
                      const barcode = normalizeBarcode(barcodeInput);
                      router.push(barcode ? `/label-scan?barcode=${encodeURIComponent(barcode)}` : "/label-scan");
                    },
                    variant: "secondary",
                  },
                  {
                    label: "Search manually",
                    onPress: () => router.push("/manual-search"),
                    variant: "secondary",
                  },
                  {
                    label: "Create custom",
                    onPress: () => {
                      const barcode = normalizeBarcode(barcodeInput);
                      router.push(barcode ? `/custom-food?barcode=${encodeURIComponent(barcode)}` : "/custom-food");
                    },
                    variant: "secondary",
                  },
                ]}
              />
            ) : null}

            {saveNotice ? (
              <InlineNotice
                title="Confirmed packaged food queued"
                body={saveNotice}
                tone="warning"
              />
            ) : null}

            <Card>
              <Text style={[styles.cardTitle, themed.ink]}>Barcode number</Text>
              <View style={styles.lookupRow}>
                <TextInput
                  ref={barcodeInputRef}
                  accessibilityLabel="Barcode number"
                  accessibilityHint="Type the number printed below a package barcode, then select Find."
                  style={[styles.input, themed.input]}
                  value={barcodeInput}
                  onChangeText={setBarcodeInput}
                  placeholder="e.g. 012345678905"
                  placeholderTextColor={palette.muted}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={lookupTypedBarcode}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Find barcode"
                  accessibilityState={{ disabled: lookupMutation.isPending }}
                  style={[
                    styles.lookupButton,
                    lookupMutation.isPending ? styles.disabledButton : undefined,
                  ]}
                  onPress={lookupTypedBarcode}
                  disabled={lookupMutation.isPending}
                >
                  <Text style={styles.lookupButtonText}>Find</Text>
                </Pressable>
              </View>
            </Card>

            {selectedFood && displayNutrients ? (
              <Card>
                <View style={styles.selectedHeader}>
                  <View style={styles.selectedCopy}>
                    <Text style={[styles.cardEyebrow, themed.muted]}>Matched packaged food</Text>
                    <Text numberOfLines={3} style={[styles.selectedTitle, themed.ink]}>
                      {readableFoodName(selectedFood.displayName)}
                    </Text>
                    <View style={styles.badgeRow}>
                      <SourceBadge
                        label={selectedFood.provider.replaceAll("_", " ")}
                        tone={selectedFood.recordConfidence === "low" ? "warning" : "success"}
                      />
                      <StatusPill
                        label={foodQualityDisplay(selectedFood.qualityAssessment).label}
                        tone={foodQualityDisplay(selectedFood.qualityAssessment).tone}
                      />
                    </View>
                    {selectedFood.brandOwner ? (
                      <Text style={[styles.resultMeta, themed.muted]}>{selectedFood.brandOwner}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Scan a different barcode"
                    style={styles.changeButton}
                    onPress={resetScan}
                  >
                    <Text style={[styles.changeButtonText, themed.actionText]}>Rescan</Text>
                  </Pressable>
                </View>

                <View style={[styles.sourcePanel, themed.subsurface]}>
                  <Text style={[styles.sourceTitle, themed.ink]}>Source and confidence</Text>
                  <Text style={[styles.sourceText, themed.muted]}>
                    {selectedFood.sourceReference}
                  </Text>
                  {selectedFood.qualityFlags?.length ? (
                    <Text style={[styles.warningText, themed.warningText]}>
                      Review before logging: {selectedFood.qualityFlags
                        .map((flag) => qualityFlagDisplay(flag).label)
                        .join(". ")}
                    </Text>
                  ) : (
                    <Text style={[styles.sourceText, themed.muted]}>
                      No obvious data-quality flags were found. Confirm the portion before logging.
                    </Text>
                  )}
                  {blocksFoodLogging(selectedFood) ? (
                    <Text style={[styles.warningText, themed.warningText]}>
                      {selectedFood.qualityAssessment?.summary}
                    </Text>
                  ) : null}
                  <Link href={foodDetailHref(selectedFood.id)} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View nutrition source for ${readableFoodName(selectedFood.displayName)}`}
                      style={[styles.sourceButton, themed.input]}
                    >
                      <Text style={[styles.sourceButtonText, themed.actionText]}>View full source</Text>
                    </Pressable>
                  </Link>
                </View>

                <View style={styles.modeRow}>
                  <ModeButton
                    active={portionMode === "grams"}
                    label="Grams"
                    onPress={() => changePortionMode("grams")}
                  />
                  <ModeButton
                    active={portionMode === "ounces"}
                    label="Ounces"
                    onPress={() => changePortionMode("ounces")}
                  />
                  <ModeButton
                    active={portionMode === "servings"}
                    label="Servings"
                    onPress={() => changePortionMode("servings")}
                    disabled={!servingGramWeight}
                  />
                </View>

                <View style={styles.amountRow}>
                  <View style={styles.amountInputWrap}>
                    <Text style={[styles.inputLabel, themed.muted]}>
                      {portionInputLabel(portionMode)}
                    </Text>
                    <TextInput
                      accessibilityLabel={portionInputLabel(portionMode)}
                      accessibilityHint="Enter the amount you ate. Nutrition is calculated from the matched source record per 100 grams."
                      style={[styles.amountInput, themed.input]}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder={portionMode === "servings" ? "1" : portionMode === "ounces" ? "3.5" : "100"}
                      placeholderTextColor={palette.muted}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>
                  <View style={[styles.servingHint, themed.subsurface]}>
                    <Text style={[styles.servingHintValue, themed.ink]}>{Math.round(grams || 0)}g</Text>
                    <Text style={[styles.servingHintLabel, themed.muted]}>used</Text>
                  </View>
                </View>

                <Text style={[styles.hintText, themed.muted]}>
                  {servingGramWeight
                    ? `1 serving = ${Math.round(servingGramWeight)}g from the source record.`
                    : "Servings are unavailable because this record has no verified gram weight. Use grams or ounces."} {portionMode === "ounces" ? "Ounces are converted to grams before macros are calculated." : ""}
                </Text>

                <View style={styles.macroGrid}>
                  <MacroStatTile style={styles.halfMacroTile} label="Calories" value={Math.round(displayNutrients.caloriesKcal)} suffix="kcal" />
                  <MacroStatTile style={styles.halfMacroTile} label="Protein" value={roundMacro(displayNutrients.proteinGrams)} suffix="g" tone="protein" />
                  <MacroStatTile style={styles.halfMacroTile} label="Carbs" value={roundMacro(displayNutrients.carbohydrateGrams)} suffix="g" tone="carbs" />
                  <MacroStatTile style={styles.halfMacroTile} label="Fat" value={roundMacro(displayNutrients.fatGrams)} suffix="g" tone="fat" />
                </View>

                <ActionButton
                  label={logMutation.isPending ? "Saving..." : "Log packaged food"}
                  onPress={logBarcodeMeal}
                  disabled={logMutation.isPending || blocksFoodLogging(selectedFood)}
                />
              </Card>
            ) : null}

            <Link href="/manual-search" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search for a food manually instead"
                style={[styles.secondaryButton, themed.subsurface]}
              >
                <Text style={[styles.secondaryButtonText, themed.ink]}>Search manually instead</Text>
              </Pressable>
            </Link>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function BarcodeSavedScreen({
  onViewToday,
  onScanAnother,
}: {
  onViewToday: () => void;
  onScanAnother: () => void;
}) {
  const { palette } = useTheme();
  const themed = barcodeThemeStyles(palette);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.muted]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Packaged food logged.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your diary uses the matched source record and portion you confirmed. You can adjust this meal later from Today.
        </Text>
        <View style={styles.savedActions}>
          <ActionButton label="View Today" onPress={onViewToday} />
          <ActionButton label="Scan another package" variant="secondary" onPress={onScanAnother} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function ModeButton({
  active,
  label,
  onPress,
  disabled = false,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { palette } = useTheme();
  const themed = barcodeThemeStyles(palette);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label} unavailable because no verified gram serving weight` : label}
      accessibilityState={{ disabled, selected: active }}
      style={[styles.modeButton, themed.subsurface, active ? styles.activeModeButton : undefined, disabled ? styles.disabledModeButton : undefined]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.modeButtonText, { color: active ? palette.onPrimary : palette.ink }, disabled ? [styles.disabledModeButtonText, { color: palette.muted }] : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
}

function barcodeThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    warningText: { color: palette.warningText },
    subsurface: { backgroundColor: palette.surfaceAlt },
    savedMark: { backgroundColor: palette.mode === "dark" ? colors.green : colors.greenDeep },
    input: { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink },
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  permissionScreen: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 112,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  title: {
    ...typography.display,
    color: colors.ink,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  textButtonLabel: {
    ...typography.button,
    color: colors.green,
  },
  savedState: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.lg },
  savedMark: { width: 72, height: 72, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.greenDeep },
  savedActions: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.sm },
  scannerCard: {
    height: 260,
    overflow: "hidden",
    borderRadius: radii.lg,
    backgroundColor: colors.ink,
  },
  camera: {
    flex: 1,
  },
  e2eCameraPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.charcoal,
  },
  e2eCameraPlaceholderText: {
    ...typography.caption,
    color: colors.white,
    textAlign: "center",
  },
  scanFrame: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: 92,
    height: 76,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.lime,
    backgroundColor: "rgba(190, 230, 76, 0.08)",
  },
  scanCaption: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: "rgba(12, 24, 20, 0.68)",
  },
  scanCaptionText: {
    ...typography.caption,
    color: colors.white,
  },
  manualLookupCard: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  lookupRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  lookupButton: {
    minWidth: 84,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.green,
  },
  lookupButtonText: {
    ...typography.button,
    color: colors.white,
  },
  loggerCard: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  selectedHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  selectedCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  cardEyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  selectedTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  resultMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  changeButton: {
    minHeight: 40,
    justifyContent: "center",
  },
  changeButtonText: {
    ...typography.button,
    color: colors.green,
  },
  sourcePanel: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  sourceTitle: {
    ...typography.caption,
    color: colors.ink,
  },
  sourceText: {
    ...typography.caption,
    color: colors.muted,
  },
  sourceButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  sourceButtonText: {
    ...typography.button,
    color: colors.green,
  },
  warningText: {
    ...typography.caption,
    color: colors.coral,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  activeModeButton: {
    backgroundColor: colors.green,
  },
  modeButtonText: {
    ...typography.button,
    color: colors.ink,
  },
  activeModeButtonText: {
    color: colors.white,
  },
  disabledModeButton: {
    opacity: 0.52,
  },
  disabledModeButtonText: {
    color: colors.muted,
  },
  amountRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-end",
  },
  amountInputWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  amountInput: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  servingHint: {
    minWidth: 88,
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  servingHintValue: {
    ...typography.heading,
    color: colors.ink,
  },
  servingHintLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  hintText: {
    ...typography.caption,
    color: colors.muted,
  },
  macroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  halfMacroTile: {
    flexBasis: "47%",
  },
  macroTile: {
    width: "48%",
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  macroValue: {
    ...typography.heading,
    color: colors.ink,
  },
  macroLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green,
  },
  disabledButton: {
    opacity: 0.62,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.white,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.ink,
  },
});
