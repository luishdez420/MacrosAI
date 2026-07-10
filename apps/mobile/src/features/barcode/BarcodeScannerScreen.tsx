import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from "expo-camera";
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

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import type { FoodSearchResult, MealCreate } from "@living-nutrition/shared-types";
import { calculateConsumedNutrients, roundNutrientsForDisplay } from "@living-nutrition/validation";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  readableFoodName,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
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

const supportedBarcodeTypes: BarcodeType[] = ["ean13", "ean8", "upc_a", "upc_e", "code128"];

export function BarcodeScannerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scannerPaused, setScannerPaused] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<BarcodeLookupStatus>("idle");
  const [lookupMessage, setLookupMessage] = useState<string | undefined>(undefined);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | undefined>(undefined);
  const [portionMode, setPortionMode] = useState<PortionMode>("servings");
  const [amount, setAmount] = useState("1");
  const lastScanRef = useRef({ barcode: "", scannedAt: 0 });
  const barcodeInputRef = useRef<TextInput>(null);
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
    },
    onError: (error) => {
      setSelectedFood(undefined);
      setLookupStatus("error");
      setLookupMessage(error.message);
      setScannerPaused(true);
    },
  });
  const logMutation = useMutation({
    mutationFn: (meal: MealCreate) => api.createMeal(meal),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      router.replace("/");
    },
    onError: (error) => {
      setLookupStatus("error");
      setLookupMessage(error.message);
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
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
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

    Keyboard.dismiss();
    logMutation.mutate(
      createMealFromFood({
        food: selectedFood,
        grams,
        servingLabel: portionLabel(portionMode, amount, servingGramWeight),
        nutrients,
        servingQuantity: parsePositiveNumber(amount),
        portionMode,
        source: "barcode",
      })
    );
  }

  function changePortionMode(nextMode: PortionMode) {
    if (nextMode === portionMode) {
      return;
    }

    setAmount(portionAmountForGrams(nextMode, grams, servingGramWeight));
    setPortionMode(nextMode);
  }

  if (!permission) {
    return <View style={styles.screen} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <Text style={styles.title}>Barcode scanning needs camera access.</Text>
        <Text style={styles.body}>
          Packaged foods are most accurate when we can match the barcode to manufacturer label data.
        </Text>
        <ActionButton label="Enable camera" onPress={requestPermission} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>Barcode logging</Text>
                <Text style={styles.title}>Scan the package.</Text>
                <Text style={styles.body}>
                  We look up packaged foods by barcode, then ask you to confirm servings or grams before saving.
                </Text>
              </View>
              <Link href="/" asChild>
                <Pressable style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Close</Text>
                </Pressable>
              </Link>
            </View>

            <View style={styles.scannerCard}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: supportedBarcodeTypes }}
                onBarcodeScanned={scannerPaused ? undefined : handleBarcodeScanned}
              />
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

            <Card>
              <Text style={styles.cardTitle}>Barcode number</Text>
              <View style={styles.lookupRow}>
                <TextInput
                  ref={barcodeInputRef}
                  style={styles.input}
                  value={barcodeInput}
                  onChangeText={setBarcodeInput}
                  placeholder="e.g. 012345678905"
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={lookupTypedBarcode}
                />
                <Pressable
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
                    <Text style={styles.cardEyebrow}>Matched packaged food</Text>
                    <Text numberOfLines={3} style={styles.selectedTitle}>
                      {readableFoodName(selectedFood.displayName)}
                    </Text>
                    <View style={styles.badgeRow}>
                      <SourceBadge
                        label={selectedFood.provider.replaceAll("_", " ")}
                        tone={selectedFood.recordConfidence === "low" ? "warning" : "success"}
                      />
                      <StatusPill
                        label={`${selectedFood.recordConfidence} confidence`}
                        tone={selectedFood.recordConfidence === "low" ? "warning" : "success"}
                      />
                    </View>
                    {selectedFood.brandOwner ? (
                      <Text style={styles.resultMeta}>{selectedFood.brandOwner}</Text>
                    ) : null}
                  </View>
                  <Pressable style={styles.changeButton} onPress={resetScan}>
                    <Text style={styles.changeButtonText}>Rescan</Text>
                  </Pressable>
                </View>

                <View style={styles.sourcePanel}>
                  <Text style={styles.sourceTitle}>Source and confidence</Text>
                  <Text style={styles.sourceText}>
                    {selectedFood.sourceReference}
                  </Text>
                  {selectedFood.qualityFlags?.length ? (
                    <Text style={styles.warningText}>
                      Review flags: {selectedFood.qualityFlags.join(", ")}
                    </Text>
                  ) : (
                    <Text style={styles.sourceText}>
                      No obvious data-quality flags were found. Confirm the portion before logging.
                    </Text>
                  )}
                  <Link href={foodDetailHref(selectedFood.id)} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View nutrition source for ${readableFoodName(selectedFood.displayName)}`}
                      style={styles.sourceButton}
                    >
                      <Text style={styles.sourceButtonText}>View full source</Text>
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
                    <Text style={styles.inputLabel}>
                      {portionInputLabel(portionMode)}
                    </Text>
                    <TextInput
                      style={styles.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                      placeholder={portionMode === "servings" ? "1" : portionMode === "ounces" ? "3.5" : "100"}
                      returnKeyType="done"
                      blurOnSubmit
                      onSubmitEditing={Keyboard.dismiss}
                    />
                  </View>
                  <View style={styles.servingHint}>
                    <Text style={styles.servingHintValue}>{Math.round(grams || 0)}g</Text>
                    <Text style={styles.servingHintLabel}>used</Text>
                  </View>
                </View>

                <Text style={styles.hintText}>
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
                  disabled={logMutation.isPending}
                />
              </Card>
            ) : null}

            <Link href="/manual-search" asChild>
              <Pressable style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Search manually instead</Text>
              </Pressable>
            </Link>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label} unavailable because no verified gram serving weight` : label}
      accessibilityState={{ disabled, selected: active }}
      style={[styles.modeButton, active ? styles.activeModeButton : undefined, disabled ? styles.disabledModeButton : undefined]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.modeButtonText, active ? styles.activeModeButtonText : undefined, disabled ? styles.disabledModeButtonText : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
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
  scannerCard: {
    height: 260,
    overflow: "hidden",
    borderRadius: radii.lg,
    backgroundColor: colors.ink,
  },
  camera: {
    flex: 1,
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
