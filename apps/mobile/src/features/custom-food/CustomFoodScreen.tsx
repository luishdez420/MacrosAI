import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Image,
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

import type { CustomFoodCreate, MealCreate, NutrientPer100g } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { calculateConsumedNutrients, roundNutrientsForDisplay } from "@living-nutrition/validation";
import { api } from "../../services/api";
import { useLabelDraftStore } from "../../stores/labelDraftStore";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  SectionHeader,
} from "../../shared/components/LivingUI";
import { createMealFromFood, parsePositiveNumber, roundMacro } from "../food-logging/foodLogging";

export function CustomFoodScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    foodId?: string;
    barcode?: string;
    labelCaptured?: string;
    labelAnalyzed?: string;
  }>();
  const foodId = stringParam(params.foodId);
  const barcode = normalizeBarcode(stringParam(params.barcode));
  const labelCaptured = stringParam(params.labelCaptured) === "1";
  const labelAnalyzed = stringParam(params.labelAnalyzed) === "1";
  const isEditing = Boolean(foodId);
  const queryClient = useQueryClient();
  const labelDraft = useLabelDraftStore((store) => store.draft);
  const clearLabelDraft = useLabelDraftStore((store) => store.clearDraft);
  const appliedLabelAnalysis = useRef(false);
  const [displayName, setDisplayName] = useState("");
  const [brandOwner, setBrandOwner] = useState("");
  const [servingSize, setServingSize] = useState("100");
  const [servingName, setServingName] = useState("");
  const [consumedGrams, setConsumedGrams] = useState("100");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [fiber, setFiber] = useState("");
  const [sugar, setSugar] = useState("");
  const [sodium, setSodium] = useState("");
  const [labelValuesReviewed, setLabelValuesReviewed] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string; tone: "warning" | "danger" } | null>(null);
  const foodDetail = useQuery({
    queryKey: ["food-detail", foodId, "custom-edit"],
    queryFn: () => api.getFood(foodId || ""),
    enabled: Boolean(foodId),
  });
  const nutrientsPer100g = buildNutrientsPer100g({ calories, protein, carbs, fat, fiber, sugar, sodium });
  const grams = parsePositiveNumber(consumedGrams);
  const preview = grams > 0 ? roundNutrientsForDisplay(calculateConsumedNutrients(nutrientsPer100g, grams)) : null;
  const createAndLogMutation = useMutation({
    mutationFn: async ({ customFood, grams }: { customFood: CustomFoodCreate; grams: number }) => {
      const savedFood = foodId
        ? await api.updateCustomFood(foodId, customFood)
        : await api.createCustomFood(customFood);
      const consumedNutrients = calculateConsumedNutrients(savedFood.nutrientsPer100g, grams);
      const meal: MealCreate = createMealFromFood({
        food: savedFood,
        grams,
        servingLabel: `${roundMacro(grams)}g custom portion`,
        nutrients: consumedNutrients,
        servingQuantity: grams,
        portionMode: "grams",
        source: "custom",
      });

      return api.createMeal(meal);
    },
    onSuccess: async () => {
      clearLabelDraft();
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "custom"] });
      await queryClient.invalidateQueries({ queryKey: ["food-detail"] });
      router.replace("/");
    },
    onError: (error) => {
      setNotice({
        title: "Custom food was not logged",
        body: error.message,
        tone: "danger",
      });
    },
  });
  const saveOnlyMutation = useMutation({
    mutationFn: (customFood: CustomFoodCreate) => {
      if (!foodId) {
        return api.createCustomFood(customFood);
      }

      return api.updateCustomFood(foodId, customFood);
    },
    onSuccess: async () => {
      clearLabelDraft();
      await queryClient.invalidateQueries({ queryKey: ["foods", "custom"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      await queryClient.invalidateQueries({ queryKey: ["food-detail"] });
      router.replace("/saved-foods");
    },
    onError: (error) => {
      setNotice({
        title: "Custom food was not saved",
        body: error.message,
        tone: "danger",
      });
    },
  });

  useEffect(() => {
    const detail = foodDetail.data;

    if (!detail) {
      return;
    }

    setDisplayName(detail.displayName);
    setBrandOwner(detail.brandOwner || "");
    setServingSize(detail.servingSize ? String(roundMacro(detail.servingSize)) : "100");
    setServingName(detail.householdServingText || "");
    setCalories(String(roundMacro(detail.nutrientsPer100g.caloriesKcal)));
    setProtein(String(roundMacro(detail.nutrientsPer100g.proteinGrams)));
    setCarbs(String(roundMacro(detail.nutrientsPer100g.carbohydrateGrams)));
    setFat(String(roundMacro(detail.nutrientsPer100g.fatGrams)));
    setFiber(detail.nutrientsPer100g.fiberGrams === undefined ? "" : String(roundMacro(detail.nutrientsPer100g.fiberGrams)));
    setSugar(detail.nutrientsPer100g.sugarGrams === undefined ? "" : String(roundMacro(detail.nutrientsPer100g.sugarGrams)));
    setSodium(
      detail.nutrientsPer100g.sodiumMilligrams === undefined
        ? ""
        : String(roundMacro(detail.nutrientsPer100g.sodiumMilligrams))
    );
  }, [foodDetail.data]);

  useEffect(() => {
    const analysis = labelDraft?.analysis;

    if (!labelCaptured || !labelAnalyzed || !analysis || isEditing || appliedLabelAnalysis.current) {
      return;
    }

    appliedLabelAnalysis.current = true;
    setDisplayName(analysis.displayName || "");
    setBrandOwner(analysis.brandOwner || "");
    setServingSize(analysis.servingSizeGrams ? String(roundMacro(analysis.servingSizeGrams)) : "");
    setServingName(analysis.servingSizeText || "");
    if (analysis.servingSizeGrams) {
      setConsumedGrams(String(roundMacro(analysis.servingSizeGrams)));
    }

    const nutrients = analysis.nutrientsPer100g;
    if (!nutrients) {
      return;
    }

    setCalories(String(roundMacro(nutrients.caloriesKcal)));
    setProtein(String(roundMacro(nutrients.proteinGrams)));
    setCarbs(String(roundMacro(nutrients.carbohydrateGrams)));
    setFat(String(roundMacro(nutrients.fatGrams)));
    setFiber(nutrients.fiberGrams === undefined ? "" : String(roundMacro(nutrients.fiberGrams)));
    setSugar(nutrients.sugarGrams === undefined ? "" : String(roundMacro(nutrients.sugarGrams)));
    setSodium(
      nutrients.sodiumMilligrams === undefined
        ? ""
        : String(roundMacro(nutrients.sodiumMilligrams))
    );
  }, [isEditing, labelAnalyzed, labelCaptured, labelDraft?.analysis]);

  function createAndLogFood() {
    Keyboard.dismiss();
    const validationError = validateCustomFood({
      displayName,
      grams,
      nutrientsPer100g,
      labelCaptured,
      labelValuesReviewed,
    });

    if (validationError) {
      setNotice({
        title: "Check custom food details",
        body: validationError,
        tone: "warning",
      });
      return;
    }

    setNotice(null);
    const customFood = buildCustomFoodPayload({
      displayName,
      barcode,
      brandOwner,
      servingSize,
      servingName,
      nutrientsPer100g,
      labelCaptured,
      labelValuesReviewed,
      labelAnalyzed: Boolean(labelDraft?.analysis),
    });
    createAndLogMutation.mutate({ customFood, grams });
  }

  function saveCustomFoodOnly() {
    Keyboard.dismiss();
    const validationError = validateCustomFood({
      displayName,
      grams: 100,
      nutrientsPer100g,
      labelCaptured,
      labelValuesReviewed,
    });

    if (validationError) {
      setNotice({
        title: "Check custom food details",
        body: validationError,
        tone: "warning",
      });
      return;
    }

    setNotice(null);
    saveOnlyMutation.mutate(
      buildCustomFoodPayload({
        displayName,
        barcode,
        brandOwner,
        servingSize,
        servingName,
        nutrientsPer100g,
        labelCaptured,
        labelValuesReviewed,
        labelAnalyzed: Boolean(labelDraft?.analysis),
      })
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>Custom food</Text>
                <Text style={styles.title}>{isEditing ? "Correct, verify, reuse." : "Create, verify, log."}</Text>
                <Text style={styles.body}>
                  {isEditing
                    ? "Update the saved per-100g values for this user-created food, then save or log a new portion."
                    : barcode
                      ? `Create a user-verified packaged food for barcode ${barcode}. Enter label data per 100g, then log the portion you ate.`
                      : "Use this when a provider record is missing. Enter label or scale data per 100g, then log the portion you ate."}
                </Text>
              </View>
              <Link href={isEditing ? "/saved-foods" : "/"} asChild>
                <Pressable
                  accessibilityRole="button"
                  style={styles.textButton}
                  onPress={clearLabelDraft}
                >
                  <Text style={styles.textButtonLabel}>Close</Text>
                </Pressable>
              </Link>
            </View>

            {foodDetail.isLoading ? (
              <InlineNotice
                title="Loading custom food"
                body="Fetching the saved values so you can review them before editing."
                tone="neutral"
              />
            ) : null}

            {foodDetail.error ? (
              <InlineNotice title="Custom food could not load" body={foodDetail.error.message} tone="danger" />
            ) : null}

            {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

            {labelCaptured ? (
              <>
                {labelDraft?.photoUri ? (
                  <Image
                    source={{ uri: labelDraft.photoUri }}
                    style={styles.labelPreview}
                    resizeMode="contain"
                    accessible
                    accessibilityLabel="Captured nutrition facts label for comparison"
                  />
                ) : null}
                <InlineNotice
                  title={labelDraft?.analysis ? "Label values extracted" : "Label photo captured"}
                  body={
                    labelDraft?.analysis
                      ? labelDraft.analysis.nutrientsPer100g
                        ? `Values were normalized from the visible ${labelBasisLabel(labelDraft.analysis.nutritionBasis)} basis. Compare every field with the photo and correct mistakes before saving.`
                        : "The label basis or core values were incomplete, so per-100g nutrition was not prefilled. Enter the values manually and verify them against the photo."
                      : "Use the photo as a reference while entering values below. Every field needs manual review."
                  }
                  tone={labelDraft?.analysis?.nutrientsPer100g ? "neutral" : "warning"}
                />
                {labelDraft?.analysis ? (
                  <>
                    <Card>
                      <SectionHeader
                        title="Visible label values"
                        meta={labelBasisLabel(labelDraft.analysis.nutritionBasis)}
                      />
                      <Text style={styles.labelValueSummary}>
                        {labelNutrientSummary(labelDraft.analysis.labelNutrients)}
                      </Text>
                      <Text style={styles.labelValueCaption}>
                        The editable fields below are per 100g only when a reliable conversion was possible.
                      </Text>
                    </Card>
                    <InlineNotice
                      title={`${labelDraft.analysis.confidence} extraction confidence`}
                      body={labelDraft.analysis.warnings.join(" ")}
                      tone={labelDraft.analysis.qualityFlags.length ? "warning" : "neutral"}
                    />
                  </>
                ) : null}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: labelValuesReviewed }}
                  accessibilityLabel="Confirm nutrition label values were manually reviewed"
                  style={styles.reviewCheck}
                  onPress={() => setLabelValuesReviewed((current) => !current)}
                >
                  <View style={[styles.reviewBox, labelValuesReviewed ? styles.reviewBoxChecked : undefined]}>
                    <Text style={styles.reviewCheckMark}>{labelValuesReviewed ? "✓" : ""}</Text>
                  </View>
                  <Text style={styles.reviewText}>
                    {labelDraft?.analysis
                      ? "I compared every extracted value with the original label and corrected any errors."
                      : "I reviewed the nutrition label photo and manually entered these values."}
                  </Text>
                </Pressable>
              </>
            ) : !isEditing ? (
              <InlineNotice
                title="Have a nutrition label?"
                body="Photograph the label first if you want a visual reference while creating this custom food."
                tone="neutral"
                actions={[
                  {
                    label: "Photograph label",
                    onPress: () => {
                      router.push(barcode ? `/label-scan?barcode=${encodeURIComponent(barcode)}` : "/label-scan");
                    },
                    variant: "secondary",
                  },
                ]}
              />
            ) : null}

            <Card>
              <SectionHeader title="Food identity" meta="User-created" />
              <LabeledInput
                label="Food name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Homemade turkey chili"
              />
              <LabeledInput
                label="Brand or source (optional)"
                value={brandOwner}
                onChangeText={setBrandOwner}
                placeholder="Home, restaurant, package brand"
              />
              <View style={styles.splitRow}>
                <LabeledInput
                  label="Serving grams"
                  value={servingSize}
                  onChangeText={setServingSize}
                  keyboardType="decimal-pad"
                  placeholder="100"
                />
                <LabeledInput
                  label="Serving name"
                  value={servingName}
                  onChangeText={setServingName}
                  placeholder="1 bowl"
                />
              </View>
            </Card>

            <Card>
              <SectionHeader title="Nutrition per 100g" meta="Required macros" />
              <View style={styles.splitRow}>
                <LabeledInput label="Calories" value={calories} onChangeText={setCalories} keyboardType="decimal-pad" />
                <LabeledInput label="Protein (g)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
              </View>
              <View style={styles.splitRow}>
                <LabeledInput label="Carbs (g)" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
                <LabeledInput label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
              </View>
              <View style={styles.splitRow}>
                <LabeledInput label="Fiber (g)" value={fiber} onChangeText={setFiber} keyboardType="decimal-pad" />
                <LabeledInput label="Sugar (g)" value={sugar} onChangeText={setSugar} keyboardType="decimal-pad" />
              </View>
              <LabeledInput
                label="Sodium (mg)"
                value={sodium}
                onChangeText={setSodium}
                keyboardType="decimal-pad"
              />
              <ActionButton
                label={saveOnlyMutation.isPending ? "Saving..." : isEditing ? "Save custom food" : "Create without logging"}
                onPress={saveCustomFoodOnly}
                disabled={saveOnlyMutation.isPending || createAndLogMutation.isPending}
                variant="secondary"
              />
            </Card>

            <Card>
              <SectionHeader title="Log portion" meta="Based on grams entered" />
              <LabeledInput
                label="Amount eaten (grams)"
                value={consumedGrams}
                onChangeText={setConsumedGrams}
                keyboardType="decimal-pad"
                placeholder="100"
              />
              {preview ? (
                <View style={styles.macroGrid}>
                  <MacroStatTile label="Calories" value={Math.round(preview.caloriesKcal)} suffix="kcal" />
                  <MacroStatTile label="Protein" value={roundMacro(preview.proteinGrams)} suffix="g" tone="protein" />
                  <MacroStatTile label="Carbs" value={roundMacro(preview.carbohydrateGrams)} suffix="g" tone="carbs" />
                  <MacroStatTile label="Fat" value={roundMacro(preview.fatGrams)} suffix="g" tone="fat" />
                </View>
              ) : null}
              <InlineNotice
                title="Custom food transparency"
                body="This record is marked as user-created, not an authoritative provider record. Review values before reuse."
                tone="neutral"
              />
              <ActionButton
                label={createAndLogMutation.isPending ? "Saving..." : isEditing ? "Save and log food" : "Create and log food"}
                onPress={createAndLogFood}
                disabled={createAndLogMutation.isPending || saveOnlyMutation.isPending}
              />
            </Card>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function buildCustomFoodPayload({
  displayName,
  barcode,
  brandOwner,
  servingSize,
  servingName,
  nutrientsPer100g,
  labelCaptured,
  labelValuesReviewed,
  labelAnalyzed,
}: {
  displayName: string;
  barcode?: string;
  brandOwner: string;
  servingSize: string;
  servingName: string;
  nutrientsPer100g: NutrientPer100g;
  labelCaptured: boolean;
  labelValuesReviewed: boolean;
  labelAnalyzed: boolean;
}): CustomFoodCreate {
  const verificationNote = labelCaptured && labelValuesReviewed
    ? labelAnalyzed
      ? "Nutrition label values were machine-extracted, compared with the original label, corrected as needed, and user-confirmed before saving."
      : "Nutrition label photo was used as a manual reference and values were user-reviewed before saving."
    : "Values were entered by the user and should be reviewed before reuse.";

  return {
    displayName: displayName.trim(),
    barcode: barcode || null,
    brandOwner: brandOwner.trim() || null,
    servingSize: parsePositiveNumber(servingSize) || null,
    servingSizeUnit: parsePositiveNumber(servingSize) > 0 ? "g" : null,
    householdServingText: servingName.trim() || null,
    nutrientsPer100g,
    notes: `User-created custom food. ${verificationNote}`,
  };
}

function labelBasisLabel(value: string) {
  if (value === "per_serving") {
    return "per-serving";
  }
  if (value === "per_100g") {
    return "per-100g";
  }
  return "unknown";
}

function labelNutrientSummary(nutrients: {
  caloriesKcal: number | null;
  proteinGrams: number | null;
  carbohydrateGrams: number | null;
  fatGrams: number | null;
  sodiumMilligrams: number | null;
}) {
  const values = [
    nutrientPart(nutrients.caloriesKcal, "kcal"),
    nutrientPart(nutrients.proteinGrams, "g protein"),
    nutrientPart(nutrients.carbohydrateGrams, "g carbs"),
    nutrientPart(nutrients.fatGrams, "g fat"),
    nutrientPart(nutrients.sodiumMilligrams, "mg sodium"),
  ].filter(Boolean);

  return values.length ? values.join(" · ") : "No core nutrition values were readable.";
}

function nutrientPart(value: number | null, suffix: string) {
  return value === null ? undefined : `${roundMacro(value)} ${suffix}`;
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeBarcode(value: string | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function LabeledInput({
  label,
  value,
  onChangeText,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: "default" | "decimal-pad";
  placeholder?: string;
}) {
  return (
    <View style={styles.inputWrap}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        autoCapitalize="none"
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={Keyboard.dismiss}
      />
    </View>
  );
}

function buildNutrientsPer100g({
  calories,
  protein,
  carbs,
  fat,
  fiber,
  sugar,
  sodium,
}: {
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  sugar: string;
  sodium: string;
}): NutrientPer100g {
  return {
    caloriesKcal: parsePositiveNumber(calories),
    proteinGrams: parsePositiveNumber(protein),
    carbohydrateGrams: parsePositiveNumber(carbs),
    fatGrams: parsePositiveNumber(fat),
    fiberGrams: optionalNumber(fiber),
    sugarGrams: optionalNumber(sugar),
    sodiumMilligrams: optionalNumber(sodium),
  };
}

function optionalNumber(value: string) {
  return value.trim() ? parsePositiveNumber(value) : undefined;
}

function validateCustomFood({
  displayName,
  grams,
  nutrientsPer100g,
  labelCaptured,
  labelValuesReviewed,
}: {
  displayName: string;
  grams: number;
  nutrientsPer100g: NutrientPer100g;
  labelCaptured: boolean;
  labelValuesReviewed: boolean;
}) {
  if (!displayName.trim()) {
    return "Add a food name so this record is recognizable later.";
  }

  if (grams <= 0) {
    return "Enter the amount eaten in grams before logging.";
  }

  if (nutrientsPer100g.caloriesKcal <= 0) {
    return "Calories per 100g must be greater than 0.";
  }

  if (
    nutrientsPer100g.proteinGrams <= 0 &&
    nutrientsPer100g.carbohydrateGrams <= 0 &&
    nutrientsPer100g.fatGrams <= 0
  ) {
    return "Enter at least one macro value per 100g.";
  }

  if (labelCaptured && !labelValuesReviewed) {
    return "Confirm you reviewed the nutrition label photo and manually entered the values before saving.";
  }

  return undefined;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 180,
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
  splitRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.ink,
  },
  macroGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  labelPreview: {
    width: "100%",
    height: 220,
    borderRadius: radii.lg,
    backgroundColor: colors.ink,
  },
  labelValueSummary: {
    ...typography.body,
    color: colors.ink,
  },
  labelValueCaption: {
    ...typography.caption,
    color: colors.muted,
  },
  reviewCheck: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  reviewBox: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.green,
    backgroundColor: colors.white,
  },
  reviewBoxChecked: {
    backgroundColor: colors.green,
  },
  reviewCheckMark: {
    ...typography.button,
    color: colors.white,
  },
  reviewText: {
    ...typography.body,
    color: colors.ink,
    flex: 1,
  },
});
