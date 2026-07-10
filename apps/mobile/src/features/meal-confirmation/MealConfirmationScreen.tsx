import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
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

import type {
  FoodSearchResult,
  MealAnalysisItem,
  MealAnalysisResult,
  MealCreate,
  NutrientPer100g,
} from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
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
import { useAnalysisDraftStore } from "../../stores/analysisDraftStore";
import { foodDetailHref } from "../food-detail/foodDetailLinks";

type PreparationMethod = "not_sure" | "raw" | "grilled" | "baked" | "fried" | "boiled" | "steamed";
type CameraReportType = "wrong_food_match" | "wrong_nutrients" | "wrong_serving" | "other";
type PrepDetailValue = "not_sure" | "no" | "yes";

type AddOnReview = {
  id: string;
  food: FoodSearchResult;
  grams: string;
};

type ItemReviewState = {
  grams?: string;
  identityConfirmed?: boolean;
  preparationMethod?: PreparationMethod;
  skinOn?: PrepDetailValue;
  boneIn?: PrepDetailValue;
  sauceOrCondiment?: PrepDetailValue;
  cheeseOrSugar?: PrepDetailValue;
  addedOilGrams?: string;
  notes?: string;
  removed?: boolean;
  markedIncorrect?: boolean;
  replacement?: FoodSearchResult;
  addOns?: AddOnReview[];
};

const preparationOptions: Array<{ label: string; value: PreparationMethod }> = [
  { label: "Not sure", value: "not_sure" },
  { label: "Raw", value: "raw" },
  { label: "Grilled", value: "grilled" },
  { label: "Baked", value: "baked" },
  { label: "Fried", value: "fried" },
  { label: "Boiled", value: "boiled" },
  { label: "Steamed", value: "steamed" },
];

const cameraReportOptions: Array<{ label: string; value: CameraReportType }> = [
  { label: "Wrong food", value: "wrong_food_match" },
  { label: "Wrong macros", value: "wrong_nutrients" },
  { label: "Serving issue", value: "wrong_serving" },
  { label: "Other", value: "other" },
];

const prepDetailOptions: Array<{ label: string; value: PrepDetailValue }> = [
  { label: "Not sure", value: "not_sure" },
  { label: "No", value: "no" },
  { label: "Yes", value: "yes" },
];

const prepDetailQuestions: Array<{
  key: "skinOn" | "boneIn" | "sauceOrCondiment" | "cheeseOrSugar";
  label: string;
}> = [
  { key: "skinOn", label: "Skin on?" },
  { key: "boneIn", label: "Bone-in?" },
  { key: "sauceOrCondiment", label: "Sauce or dressing?" },
  { key: "cheeseOrSugar", label: "Cheese or sugar?" },
];

export function MealConfirmationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [itemReviews, setItemReviews] = useState<Record<string, ItemReviewState>>({});
  const [extraItems, setExtraItems] = useState<MealAnalysisItem[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const draftPhoto = useAnalysisDraftStore((store) => store.draftPhoto);
  const clearDraft = useAnalysisDraftStore((store) => store.clearDraft);
  const analysis = useQuery({
    queryKey: ["meal-analysis", draftPhoto?.uri],
    queryFn: async () => {
      await api.healthCheck();
      return api.analyzeMealPhoto({
        imageBase64: draftPhoto?.base64 || "",
        idempotencyKey: draftPhoto?.uri,
      });
    },
    enabled: Boolean(draftPhoto?.base64),
    retry: false,
  });
  const logMutation = useMutation({
    mutationFn: (meal: MealCreate) => api.createMeal(meal),
    onSuccess: async () => {
      clearDraft();
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      router.replace("/");
    },
    onError: (error) => {
      setSaveNotice(error.message);
    },
  });

  function updateItemReview(itemId: string, patch: ItemReviewState) {
    setItemReviews((current) => ({
      ...current,
      [itemId]: {
        ...current[itemId],
        ...patch,
      },
    }));
  }

  function duplicateItem(item: MealAnalysisItem, gramsOverride?: string) {
    const copyId = `${item.id}-copy-${Date.now()}`;
    const sourceReview = itemReviews[item.id] ?? {};
  const copy = {
      ...item,
      id: copyId,
      notes: item.notes ? `${item.notes} Duplicated for separate portion review.` : "Duplicated for separate portion review.",
    };

    setExtraItems((current) => [...current, copy]);
    setItemReviews((current) => ({
      ...current,
      [copyId]: {
        ...sourceReview,
        grams: gramsOverride ?? sourceReview.grams ?? String(Math.round(item.servingGrams)),
        identityConfirmed: false,
      },
    }));
  }

  function splitItem(item: MealAnalysisItem) {
    const currentGrams = parsePositiveNumber(itemReviews[item.id]?.grams) || item.servingGrams;
    const halfGrams = String(roundMacro(Math.max(currentGrams / 2, 1)));
    updateItemReview(item.id, { grams: halfGrams });
    duplicateItem(item, halfGrams);
  }

  function restoreItem(itemId: string) {
    updateItemReview(itemId, { removed: false, markedIncorrect: false });
  }

  function logResult(meal: MealAnalysisResult) {
    const activeItems = activeAnalysisItems(meal.items, extraItems, itemReviews);
    const validationMessage = validateReviewedItems(activeItems, itemReviews);

    if (validationMessage) {
      setSaveNotice(validationMessage);
      return;
    }

    Keyboard.dismiss();
    setSaveNotice(null);
    logMutation.mutate(createMealFromAnalysis(meal, activeItems, itemReviews));
  }

  function retakePhoto() {
    clearDraft();
    router.replace("/camera");
  }

  if (!draftPhoto?.uri) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.emptyState}>
          <Text style={styles.eyebrow}>No photo</Text>
          <Text style={styles.title}>Start with a meal photo.</Text>
          <Text style={styles.body}>Use the camera so we can identify foods and match USDA records.</Text>
          <Link href="/camera" asChild>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Open camera</Text>
            </Pressable>
          </Link>
        </View>
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
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>{analysis.data?.status === "ready" ? "Ready to log" : "Scan result"}</Text>
                <Text style={styles.title}>
                  {analysis.data?.mealName || (analysis.isLoading ? "Analyzing your meal." : "Meal estimate")}
                </Text>
              </View>
              <Pressable style={styles.textButton} onPress={retakePhoto}>
                <Text style={styles.textButtonLabel}>Retake</Text>
              </Pressable>
            </View>

            <Image source={{ uri: draftPhoto.uri }} style={styles.preview} />

            {saveNotice ? (
              <InlineNotice title="Meal was not saved" body={saveNotice} tone="danger" />
            ) : null}

            {!draftPhoto.base64 ? (
              <MessageCard
                title="Photo data unavailable"
                body="This photo did not include analyzable image data. Retake it or import another photo."
                tone="review"
              />
            ) : null}

            {analysis.isLoading ? <AnalyzingCard /> : null}

            {analysis.error ? (
              <MessageCard
                title={
                  analysis.error.message.includes("Cannot reach")
                    ? "API connection failed"
                    : "Analysis failed"
                }
                body={analysis.error.message}
                tone="review"
              />
            ) : null}

            {analysis.data ? (
              <>
                <ResultSummary
                  meal={analysis.data}
                  items={activeAnalysisItems(analysis.data.items, extraItems, itemReviews)}
                  itemReviews={itemReviews}
                />

                <View style={styles.panel}>
                  <Text style={styles.sectionTitle}>Detected foods</Text>
                  {activeAnalysisItems(analysis.data.items, extraItems, itemReviews).map((item) => (
                    <FoodItemCard
                      key={item.id}
                      item={item}
                      review={itemReviews[item.id] ?? {}}
                      onChangeReview={(patch) => updateItemReview(item.id, patch)}
                      onDuplicate={() => duplicateItem(item)}
                      onSplit={() => splitItem(item)}
                    />
                  ))}
                  <RemovedItemsList
                    items={removedAnalysisItems(analysis.data.items, extraItems, itemReviews)}
                    itemReviews={itemReviews}
                    onRestore={restoreItem}
                  />
                </View>

                <View style={styles.actionRow}>
                  <ActionButton
                    label={
                      logMutation.isPending
                        ? "Saving..."
                        : analysis.data.status === "ready"
                          ? "Log meal"
                          : "Log estimate"
                    }
                    onPress={() => logResult(analysis.data)}
                    disabled={logMutation.isPending}
                    style={styles.flexAction}
                  />
                  <Link href="/manual-search" asChild>
                    <Pressable style={styles.secondaryButton}>
                      <Text style={styles.secondaryButtonText}>Search instead</Text>
                    </Pressable>
                  </Link>
                </View>
              </>
            ) : null}
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AnalyzingCard() {
  return (
    <Card>
      <Text style={styles.messageTitle}>Matching against USDA</Text>
      <Text style={styles.body}>
        We are identifying visible foods first, then calculating nutrition from USDA records instead
        of asking the model to invent macros.
      </Text>
      <View style={styles.progressRail}>
        <View style={styles.progressFill} />
      </View>
    </Card>
  );
}

function ResultSummary({
  meal,
  items,
  itemReviews,
}: {
  meal: MealAnalysisResult;
  items: MealAnalysisItem[];
  itemReviews: Record<string, ItemReviewState>;
}) {
  const isReady = meal.status === "ready";
  const totals = sumAdjustedNutrients(items, itemReviews);
  const reviewCount = items.filter((item) => isItemReadyForLogging(item, itemReviews[item.id])).length;

  return (
    <Card>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryCopy}>
          <StatusPill
            label={isReady ? "Ready to log" : "Needs confirmation"}
            tone={isReady ? "success" : "warning"}
          />
          <Text style={styles.summaryTitle}>{Math.round(totals.caloriesKcal)} kcal</Text>
          <Text style={styles.body}>
            Estimated from the scan, then recalculated from the food, preparation, oil, and grams you confirm below.
          </Text>
          <Text style={styles.sourceText}>
            {reviewCount} of {items.length} foods reviewed for logging.
          </Text>
        </View>
      </View>
      <View style={styles.macroGrid}>
        <MacroStatTile label="Protein" value={roundMacro(totals.proteinGrams)} suffix="g" tone="protein" />
        <MacroStatTile label="Carbs" value={roundMacro(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
        <MacroStatTile label="Fat" value={roundMacro(totals.fatGrams)} suffix="g" tone="fat" />
      </View>
      {meal.summary ? <Text style={styles.sourceText}>{meal.summary}</Text> : null}
    </Card>
  );
}

function FoodItemCard({
  item,
  review,
  onChangeReview,
  onDuplicate,
  onSplit,
}: {
  item: MealAnalysisItem;
  review: ItemReviewState;
  onChangeReview: (patch: ItemReviewState) => void;
  onDuplicate: () => void;
  onSplit: () => void;
}) {
  const confirmedGrams = review.grams ?? String(Math.round(item.servingGrams));
  const grams = parsePositiveNumber(confirmedGrams) || item.servingGrams;
  const addedOilGrams = parsePositiveNumber(review.addedOilGrams);
  const addOns = review.addOns ?? [];
  const nutrients = adjustedNutrients(item, grams, addedOilGrams, review.replacement, addOns);
  const preparationMethod = review.preparationMethod;
  const itemReady = isItemReadyForLogging(item, review);
  const displayName = review.replacement?.displayName ?? item.displayName;
  const provider = review.replacement?.provider ?? item.provider;
  const dataType = review.replacement?.dataType ?? item.dataType;
  const externalId = review.replacement?.externalId ?? item.externalId;
  const sourceFoodId = `${provider}:${externalId}`;
  const canReportSource = externalId !== "unmatched" && dataType !== "unmatched";
  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState<CameraReportType>("wrong_food_match");
  const [reportMessage, setReportMessage] = useState("");
  const [reportNotice, setReportNotice] = useState<{
    title: string;
    body: string;
    tone: "success" | "warning" | "danger";
  } | null>(null);
  const sourceReportMutation = useMutation({
    mutationFn: () =>
      api.createFoodCorrectionReport(sourceFoodId, {
        reportType,
        message:
          reportMessage.trim() ||
          `Camera confirmation report: detected "${item.detectedName}" but matched "${displayName}".`,
      }),
    onSuccess: () => {
      setReportMessage("");
      setReportNotice({
        title: "Report sent",
        body: "Thanks. This flags the source match for review without saving this estimate.",
        tone: "success",
      });
    },
    onError: (error) => {
      setReportNotice({
        title: "Report was not sent",
        body: error.message,
        tone: "danger",
      });
    },
  });

  function submitSourceReport() {
    if (!canReportSource) {
      setReportNotice({
        title: "No source to report",
        body: "This item did not match a provider record. Use replacement search or remove it before logging.",
        tone: "warning",
      });
      return;
    }

    sourceReportMutation.mutate();
  }

  return (
    <Card>
      <View style={styles.itemTop}>
        <View style={styles.itemCopy}>
          <Text numberOfLines={2} style={styles.itemTitle}>
            {readableFoodName(displayName)}
          </Text>
          <Text style={styles.itemMeta}>
            Detected as {item.detectedName} · {item.servingLabel} · {Math.round(item.servingGrams)}g
          </Text>
          {review.replacement ? (
            <Text style={styles.replacementMeta}>
              User replacement selected from {review.replacement.provider.replaceAll("_", " ")}.
            </Text>
          ) : null}
        </View>
        <StatusPill
          label={itemReady ? "Reviewed" : "Needs review"}
          tone={itemReady ? "success" : "warning"}
        />
      </View>
      <View style={styles.reviewActionRow}>
        <Pressable
          accessibilityRole="button"
          style={[styles.reviewButton, review.identityConfirmed ? styles.activeReviewButton : undefined]}
          onPress={() => onChangeReview({ identityConfirmed: !review.identityConfirmed })}
        >
          <Text style={[styles.reviewButtonText, review.identityConfirmed ? styles.activeReviewButtonText : undefined]}>
            {review.identityConfirmed ? "Food confirmed" : "Confirm this food"}
          </Text>
        </Pressable>
        <Link href="/manual-search" asChild>
          <Pressable accessibilityRole="button" style={styles.reviewButton}>
            <Text style={styles.reviewButtonText}>Manual search fallback</Text>
          </Pressable>
        </Link>
      </View>
      <FoodReplacementSearch
        item={item}
        selectedReplacement={review.replacement}
        onSelectReplacement={(replacement) =>
          onChangeReview({
            replacement,
            identityConfirmed: true,
            grams: review.grams ?? String(Math.round(grams)),
          })
        }
        onClearReplacement={() => onChangeReview({ replacement: undefined, identityConfirmed: false })}
      />
      <View style={styles.amountRow}>
        <View style={styles.amountInputWrap}>
          <Text style={styles.inputLabel}>Confirm weight in grams</Text>
          <TextInput
            style={styles.amountInput}
            value={confirmedGrams}
            onChangeText={(value) => onChangeReview({ grams: value })}
            keyboardType="decimal-pad"
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={styles.servingHint}>
          <Text style={styles.servingHintValue}>{Math.round(grams)}g</Text>
          <Text style={styles.servingHintLabel}>used</Text>
        </View>
      </View>
      <Text style={styles.sourceText}>
        Single-image portion estimates need confirmation. Adjust grams if the scan looks off.
      </Text>
      <FoodAddOnSearch
        addOns={addOns}
        onChangeAddOns={(nextAddOns) => onChangeReview({ addOns: nextAddOns })}
      />
      <View style={styles.preparationPanel}>
        <Text style={styles.inputLabel}>Preparation</Text>
        <View style={styles.preparationGrid}>
          {preparationOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              style={[
                styles.preparationChip,
                preparationMethod === option.value ? styles.activePreparationChip : undefined,
              ]}
              onPress={() => onChangeReview({ preparationMethod: option.value })}
            >
              <Text
                style={[
                  styles.preparationChipText,
                  preparationMethod === option.value ? styles.activePreparationChipText : undefined,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.preparationPanel}>
        <Text style={styles.inputLabel}>Hidden ingredient checks</Text>
        <Text style={styles.sourceText}>
          Photos cannot confirm these details. Pick what applies so the saved meal keeps your review context.
        </Text>
        <View style={styles.prepDetailStack}>
          {prepDetailQuestions.map((question) => (
            <View key={question.key} style={styles.prepDetailRow}>
              <Text style={styles.prepDetailLabel}>{question.label}</Text>
              <View style={styles.prepDetailOptions}>
                {prepDetailOptions.map((option) => {
                  const active = (review[question.key] ?? "not_sure") === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      style={[
                        styles.prepDetailChip,
                        active ? styles.activePrepDetailChip : undefined,
                      ]}
                      onPress={() => onChangeReview({ [question.key]: option.value })}
                    >
                      <Text
                        style={[
                          styles.prepDetailChipText,
                          active ? styles.activePrepDetailChipText : undefined,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.amountRow}>
        <View style={styles.amountInputWrap}>
          <Text style={styles.inputLabel}>Added oil or butter (grams)</Text>
          <TextInput
            style={styles.amountInput}
            value={review.addedOilGrams ?? ""}
            onChangeText={(value) => onChangeReview({ addedOilGrams: value })}
            keyboardType="decimal-pad"
            placeholder="0"
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={styles.servingHint}>
          <Text style={styles.servingHintValue}>{Math.round(addedOilGrams * 9)}</Text>
          <Text style={styles.servingHintLabel}>oil kcal</Text>
        </View>
      </View>
      <View style={styles.amountInputWrap}>
        <Text style={styles.inputLabel}>Sauces, toppings, or notes</Text>
        <TextInput
          style={[styles.amountInput, styles.notesInput]}
          value={review.notes ?? ""}
          onChangeText={(value) => onChangeReview({ notes: value })}
          placeholder="e.g. ranch dressing, cheese, skin removed"
          multiline
          returnKeyType="done"
        />
      </View>
      <View style={styles.compactMacros}>
        <Text style={styles.compactMacro}>{Math.round(nutrients.caloriesKcal)} kcal</Text>
        <Text style={styles.compactMacro}>{roundMacro(nutrients.proteinGrams)}g P</Text>
        <Text style={styles.compactMacro}>{roundMacro(nutrients.carbohydrateGrams)}g C</Text>
        <Text style={styles.compactMacro}>{roundMacro(nutrients.fatGrams)}g F</Text>
      </View>
      <View style={styles.badgeRow}>
        <SourceBadge label={provider.replaceAll("_", " ")} tone="success" />
        <SourceBadge label={dataType} />
      </View>
      <Link href={foodDetailHref(`${provider}:${externalId}`, { contextLabel: "Camera estimate source" })} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View nutrition source for ${readableFoodName(displayName)}`}
          style={styles.sourceButton}
        >
          <Text style={styles.sourceButtonText}>View source</Text>
        </Pressable>
      </Link>
      <Text style={styles.sourceText}>{item.confidence.explanation}</Text>
      <View style={styles.cameraReportPanel}>
        <View style={styles.reportHeader}>
          <View style={styles.itemCopy}>
            <Text style={styles.inputLabel}>Report this source match</Text>
            <Text style={styles.sourceText}>
              Use this if the camera matched the wrong food or the provider data looks off.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.reviewButton}
            onPress={() => setReportOpen((current) => !current)}
          >
            <Text style={styles.reviewButtonText}>{reportOpen ? "Hide report" : "Report"}</Text>
          </Pressable>
        </View>
        {reportNotice ? (
          <InlineNotice title={reportNotice.title} body={reportNotice.body} tone={reportNotice.tone} />
        ) : null}
        {reportOpen ? (
          <View style={styles.reportForm}>
            <View style={styles.reportTypeRow}>
              {cameraReportOptions.map((option) => {
                const active = option.value === reportType;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    style={[styles.reportTypeChip, active ? styles.activeReportTypeChip : undefined]}
                    onPress={() => setReportType(option.value)}
                  >
                    <Text style={[styles.reportTypeText, active ? styles.activeReportTypeText : undefined]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={[styles.amountInput, styles.notesInput]}
              value={reportMessage}
              onChangeText={setReportMessage}
              placeholder="Optional: what looks wrong about this source?"
              multiline
              returnKeyType="done"
            />
            <ActionButton
              label={sourceReportMutation.isPending ? "Sending..." : "Send report"}
              variant="secondary"
              onPress={submitSourceReport}
              disabled={sourceReportMutation.isPending}
            />
          </View>
        ) : null}
      </View>
      {item.notes ? <Text style={styles.noteText}>{item.notes}</Text> : null}
      <View style={styles.reviewActionRow}>
        <Pressable accessibilityRole="button" style={styles.reviewButton} onPress={onDuplicate}>
          <Text style={styles.reviewButtonText}>Duplicate</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.reviewButton} onPress={onSplit}>
          <Text style={styles.reviewButtonText}>Split</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.reviewButton}
          onPress={() => onChangeReview({ removed: true, markedIncorrect: false })}
        >
          <Text style={styles.reviewButtonText}>Remove</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.dangerReviewButton}
          onPress={() => onChangeReview({ removed: true, markedIncorrect: true })}
        >
          <Text style={styles.dangerReviewButtonText}>Mark incorrect</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function FoodReplacementSearch({
  item,
  selectedReplacement,
  onSelectReplacement,
  onClearReplacement,
}: {
  item: MealAnalysisItem;
  selectedReplacement?: FoodSearchResult;
  onSelectReplacement: (replacement: FoodSearchResult) => void;
  onClearReplacement: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState("");
  const candidateLabels = item.candidateLabels.filter(
    (label) => label.trim() && label.trim().toLowerCase() !== item.displayName.toLowerCase()
  );
  const replacementSearch = useQuery({
    queryKey: ["camera-replacement-search", item.id, replacementQuery.trim()],
    queryFn: () => api.searchFoods(replacementQuery.trim()),
    enabled: searchOpen && replacementQuery.trim().length >= 2,
  });

  return (
    <View style={styles.replacementPanel}>
      <View style={styles.replacementHeader}>
        <View style={styles.itemCopy}>
          <Text style={styles.inputLabel}>Food identity</Text>
          <Text style={styles.sourceText}>
            Search replacement if the detected food is wrong or too generic.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.reviewButton}
          onPress={() => setSearchOpen((current) => !current)}
        >
          <Text style={styles.reviewButtonText}>{searchOpen ? "Hide search" : "Replace food"}</Text>
        </Pressable>
      </View>

      {candidateLabels.length ? (
        <View style={styles.candidatePanel}>
          <Text style={styles.inputLabel}>AI identity candidates</Text>
          <Text style={styles.sourceText}>
            These are search suggestions, not confirmed nutrition records. Pick a matching source before logging.
          </Text>
          <View style={styles.candidateRow}>
            {candidateLabels.map((label) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={`Search nutrition records for ${label}`}
                style={styles.candidateChip}
                onPress={() => {
                  setSearchOpen(true);
                  setReplacementQuery(label);
                }}
              >
                <Text style={styles.candidateChipText}>{readableFoodName(label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {selectedReplacement ? (
        <View style={styles.replacementSelection}>
          <View style={styles.itemCopy}>
            <Text style={styles.replacementTitle}>{readableFoodName(selectedReplacement.displayName)}</Text>
            <Text style={styles.sourceText}>
              {Math.round(selectedReplacement.nutrientsPer100g.caloriesKcal)} kcal per 100g -{" "}
              {selectedReplacement.provider.replaceAll("_", " ")}
            </Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.clearReplacementButton} onPress={onClearReplacement}>
            <Text style={styles.clearReplacementButtonText}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {searchOpen ? (
        <View style={styles.replacementSearchStack}>
          <TextInput
            style={styles.amountInput}
            value={replacementQuery}
            onChangeText={setReplacementQuery}
            placeholder={`Search instead of ${item.detectedName}`}
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit
          />
          {replacementSearch.isLoading ? (
            <Text style={styles.sourceText}>Searching nutrition records...</Text>
          ) : null}
          {replacementQuery.trim().length >= 2 && !replacementSearch.isLoading && !replacementSearch.data?.items.length ? (
            <Text style={styles.noteText}>No replacement foods found yet. Try a simpler food name.</Text>
          ) : null}
          {(replacementSearch.data?.items ?? []).slice(0, 4).map((food) => (
            <Pressable
              key={food.id}
              accessibilityRole="button"
              style={styles.replacementResult}
              onPress={() => {
                onSelectReplacement(food);
                setSearchOpen(false);
                setReplacementQuery("");
              }}
            >
              <View style={styles.itemCopy}>
                <Text numberOfLines={2} style={styles.replacementTitle}>
                  {readableFoodName(food.displayName)}
                </Text>
                <Text numberOfLines={1} style={styles.sourceText}>
                  {Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g - {food.dataType}
                </Text>
              </View>
              <SourceBadge label={food.provider.replaceAll("_", " ")} tone={food.recordConfidence === "low" ? "warning" : "success"} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function FoodAddOnSearch({
  addOns,
  onChangeAddOns,
}: {
  addOns: AddOnReview[];
  onChangeAddOns: (addOns: AddOnReview[]) => void;
}) {
  const [addOnQuery, setAddOnQuery] = useState("");
  const addOnSearch = useQuery({
    queryKey: ["camera-addon-search", addOnQuery.trim()],
    queryFn: () => api.searchFoods(addOnQuery.trim()),
    enabled: addOnQuery.trim().length >= 2,
  });

  function addFood(food: FoodSearchResult) {
    onChangeAddOns([
      ...addOns,
      {
        id: `${food.id}-${Date.now()}`,
        food,
        grams: String(defaultAddOnGrams(food)),
      },
    ]);
    setAddOnQuery("");
  }

  function updateAddOn(addOnId: string, patch: Partial<AddOnReview>) {
    onChangeAddOns(
      addOns.map((addOn) => (addOn.id === addOnId ? { ...addOn, ...patch } : addOn))
    );
  }

  function removeAddOn(addOnId: string) {
    onChangeAddOns(addOns.filter((addOn) => addOn.id !== addOnId));
  }

  return (
    <View style={styles.addOnPanel}>
      <Text style={styles.inputLabel}>Sauces, toppings, or add-ons with macros</Text>
      <Text style={styles.sourceText}>
        Search a provider-backed record when sauce, cheese, sugar, dressing, or another add-on should count toward macros.
      </Text>
      <TextInput
        style={styles.amountInput}
        value={addOnQuery}
        onChangeText={setAddOnQuery}
        placeholder="Search ranch, cheese, sugar, avocado..."
        autoCapitalize="none"
        returnKeyType="search"
        blurOnSubmit
      />
      {addOnSearch.isLoading ? <Text style={styles.sourceText}>Searching add-ons...</Text> : null}
      {addOnQuery.trim().length >= 2 && !addOnSearch.isLoading && !addOnSearch.data?.items.length ? (
        <Text style={styles.noteText}>No add-ons found yet. Try a simpler name.</Text>
      ) : null}
      {(addOnSearch.data?.items ?? []).slice(0, 3).map((food) => (
        <Pressable
          key={food.id}
          accessibilityRole="button"
          style={styles.addOnResult}
          onPress={() => addFood(food)}
        >
          <View style={styles.itemCopy}>
            <Text numberOfLines={2} style={styles.replacementTitle}>
              {readableFoodName(food.displayName)}
            </Text>
            <Text numberOfLines={1} style={styles.sourceText}>
              {Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g - {food.dataType}
            </Text>
          </View>
          <Text style={styles.addOnAddText}>Add</Text>
        </Pressable>
      ))}
      {addOns.length ? (
        <View style={styles.addOnList}>
          {addOns.map((addOn) => {
            const grams = parsePositiveNumber(addOn.grams);
            const nutrients = scalePer100gNutrients(addOn.food.nutrientsPer100g, grams);
            const hasQualityFlags = Boolean(addOn.food.qualityFlags?.length);
            return (
              <View key={addOn.id} style={styles.addOnRow}>
                <View style={styles.itemCopy}>
                  <Text numberOfLines={2} style={styles.replacementTitle}>
                    {readableFoodName(addOn.food.displayName)}
                  </Text>
                  <Text style={styles.sourceText}>
                    {grams > 0
                      ? `${Math.round(nutrients.caloriesKcal)} kcal · ${roundMacro(nutrients.proteinGrams)}g protein`
                      : "Enter grams greater than 0 before logging."}
                  </Text>
                  {hasQualityFlags ? (
                    <Text style={styles.noteText}>
                      Source has quality warnings. Review it before relying on this add-on.
                    </Text>
                  ) : null}
                  <Link href={foodDetailHref(addOn.food.id, { contextLabel: "Camera add-on source" })} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View nutrition source for ${readableFoodName(addOn.food.displayName)} add-on`}
                      style={styles.inlineSourceButton}
                    >
                      <Text style={styles.sourceButtonText}>View add-on source</Text>
                    </Pressable>
                  </Link>
                </View>
                <TextInput
                  style={styles.addOnGramInput}
                  value={addOn.grams}
                  onChangeText={(value) => updateAddOn(addOn.id, { grams: value })}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Grams for ${readableFoodName(addOn.food.displayName)} add-on`}
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${readableFoodName(addOn.food.displayName)} add-on`}
                  style={styles.clearReplacementButton}
                  onPress={() => removeAddOn(addOn.id)}
                >
                  <Text style={styles.clearReplacementButtonText}>Remove</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function createMealFromAnalysis(
  meal: MealAnalysisResult,
  items: MealAnalysisItem[],
  itemReviews: Record<string, ItemReviewState>
): MealCreate {
  return {
    name: meal.mealName,
    loggedAt: new Date().toISOString(),
    notes: meal.notes || meal.summary,
    items: items.flatMap((item) => {
      const review = itemReviews[item.id] ?? {};
      const confirmedGrams = parsePositiveNumber(review.grams) || item.servingGrams;
      const replacement = review.replacement;
      const addedOilGrams = parsePositiveNumber(review.addedOilGrams);
      const nutrients = adjustedNutrients(item, confirmedGrams, addedOilGrams, replacement);
      const addOns = review.addOns ?? [];
      const preparationMethod = review.preparationMethod ?? "not_sure";
      const sourceProvider = replacement?.provider ?? item.provider;
      const sourceExternalId = replacement?.externalId ?? item.externalId;
      const sourceVersion = replacement
        ? replacement.publicationDate || replacement.dataType
        : item.dataType;
      const sourceReference = replacement?.sourceReference ?? item.sourceReference;
      const displayName = replacement?.displayName ?? item.displayName;
      const prepDetails = prepDetailSummary(review);
      const addOnSummary = addOns.length
        ? `Add-ons logged separately: ${addOns
            .map((addOn) => `${readableFoodName(addOn.food.displayName)} ${roundMacro(parsePositiveNumber(addOn.grams))}g`)
            .join(", ")}.`
        : undefined;
      const itemNotes = [
        item.notes,
        replacement ? `Detected as ${item.displayName}; user replaced with ${replacement.displayName}.` : undefined,
        prepDetails ? `Prep details: ${prepDetails}.` : undefined,
        addOnSummary,
        review.notes ? `User note: ${review.notes}` : undefined,
        addedOilGrams > 0 ? `Added oil or butter: ${roundMacro(addedOilGrams)}g.` : undefined,
      ]
        .filter(Boolean)
        .join(" ");

      const baseMealItem = {
        foodId: `${sourceProvider}:${sourceExternalId}`,
        displayName,
        consumedGrams: confirmedGrams,
        servingQuantity: confirmedGrams,
        servingUnit: "grams",
        calories: nutrients.caloriesKcal,
        proteinGrams: nutrients.proteinGrams,
        carbohydrateGrams: nutrients.carbohydrateGrams,
        fatGrams: nutrients.fatGrams,
        fiberGrams: nutrients.fiberGrams,
        sugarGrams: nutrients.sugarGrams,
        sodiumMilligrams: nutrients.sodiumMilligrams,
        sourceProvider,
        sourceExternalId,
        sourceVersion,
        sourceReference,
        nutrientSnapshotJson: {
          analysisId: meal.id,
          detectedName: item.detectedName,
          originalMatchedName: item.displayName,
          replacementFoodId: replacement ? `${replacement.provider}:${replacement.externalId}` : undefined,
          replacementDisplayName: replacement?.displayName,
          replacementNutrientsPer100g: replacement?.nutrientsPer100g,
          originalEstimatedGrams: item.servingGrams,
          confirmedGrams,
          preparationMethod,
          prepDetails: {
            skinOn: review.skinOn ?? "not_sure",
            boneIn: review.boneIn ?? "not_sure",
            sauceOrCondiment: review.sauceOrCondiment ?? "not_sure",
            cheeseOrSugar: review.cheeseOrSugar ?? "not_sure",
          },
          addedOilGrams,
          addOns: addOns.map((addOn) => ({
            foodId: addOn.food.id,
            displayName: addOn.food.displayName,
            grams: parsePositiveNumber(addOn.grams),
            provider: addOn.food.provider,
            externalId: addOn.food.externalId,
          })),
          userNotes: review.notes ?? "",
          identityConfirmed: Boolean(review.identityConfirmed),
          servingLabel: `${roundMacro(confirmedGrams)}g confirmed`,
          consumedNutrients: nutrients,
          confidence: item.confidence,
          sourceReference,
        },
        confidence: {
          ...item.confidence,
          identity: replacement ? "verified" as const : item.confidence.identity,
          nutritionRecord: replacement?.recordConfidence ?? item.confidence.nutritionRecord,
          portion: "verified" as const,
          explanation: replacement
            ? "Food source replaced by the user; calories are based on the portion entered."
            : "Food source matched from the scan; calories are based on the portion entered.",
        },
        userConfirmed: true,
        preparationMethod,
        addedOilGrams,
        notes: itemNotes || undefined,
      };

      const addOnMealItems = addOns.map((addOn) => {
        const addOnGrams = parsePositiveNumber(addOn.grams);
        const addOnNutrients = scalePer100gNutrients(addOn.food.nutrientsPer100g, addOnGrams);

        return {
          foodId: `${addOn.food.provider}:${addOn.food.externalId}`,
          displayName: `${readableFoodName(addOn.food.displayName)} add-on`,
          consumedGrams: addOnGrams,
          servingQuantity: addOnGrams,
          servingUnit: "grams",
          calories: addOnNutrients.caloriesKcal,
          proteinGrams: addOnNutrients.proteinGrams,
          carbohydrateGrams: addOnNutrients.carbohydrateGrams,
          fatGrams: addOnNutrients.fatGrams,
          fiberGrams: addOnNutrients.fiberGrams,
          sugarGrams: addOnNutrients.sugarGrams,
          sodiumMilligrams: addOnNutrients.sodiumMilligrams,
          sourceProvider: addOn.food.provider,
          sourceExternalId: addOn.food.externalId,
          sourceVersion: addOn.food.publicationDate || addOn.food.dataType,
          sourceReference: addOn.food.sourceReference,
          nutrientSnapshotJson: {
            analysisId: meal.id,
            addOnForDetectedName: item.detectedName,
            addOnForDisplayName: displayName,
            grams: addOnGrams,
            sourceReference: addOn.food.sourceReference,
            consumedNutrients: addOnNutrients,
          },
          confidence: {
            identity: "verified" as const,
            portion: "verified" as const,
            nutritionRecord: addOn.food.recordConfidence,
            explanation: "Provider-backed add-on selected during camera confirmation.",
          },
          userConfirmed: true,
          preparationMethod: "add_on",
          addedOilGrams: 0,
          notes: `Added to ${readableFoodName(displayName)} during camera confirmation.`,
        };
      });

      return [baseMealItem, ...addOnMealItems];
    }),
  };
}

function RemovedItemsList({
  items,
  itemReviews,
  onRestore,
}: {
  items: MealAnalysisItem[];
  itemReviews: Record<string, ItemReviewState>;
  onRestore: (itemId: string) => void;
}) {
  if (!items.length) {
    return null;
  }

  return (
    <View style={styles.removedList}>
      {items.map((item) => (
        <InlineNotice
          key={item.id}
          title={`${readableFoodName(item.displayName)} ${
            itemReviews[item.id]?.markedIncorrect ? "marked incorrect" : "removed"
          }`}
          body="This item will not be saved unless you restore it."
          tone="warning"
          actions={[{ label: "Restore", onPress: () => onRestore(item.id), variant: "secondary" }]}
        />
      ))}
    </View>
  );
}

function activeAnalysisItems(
  baseItems: MealAnalysisItem[],
  extraItems: MealAnalysisItem[],
  itemReviews: Record<string, ItemReviewState>
) {
  return [...baseItems, ...extraItems].filter((item) => !itemReviews[item.id]?.removed);
}

function removedAnalysisItems(
  baseItems: MealAnalysisItem[],
  extraItems: MealAnalysisItem[],
  itemReviews: Record<string, ItemReviewState>
) {
  return [...baseItems, ...extraItems].filter((item) => itemReviews[item.id]?.removed);
}

function validateReviewedItems(items: MealAnalysisItem[], itemReviews: Record<string, ItemReviewState>) {
  if (!items.length) {
    return "Keep at least one detected food or search manually before logging.";
  }

  const missingReview = items.find((item) => !isItemReadyForLogging(item, itemReviews[item.id]));

  if (missingReview) {
    return `Review ${readableFoodName(missingReview.displayName)} before logging: confirm the food, choose a preparation, and enter grams greater than 0.`;
  }

  const missingAddOnGrams = items.find((item) =>
    (itemReviews[item.id]?.addOns ?? []).some((addOn) => parsePositiveNumber(addOn.grams) <= 0)
  );

  if (missingAddOnGrams) {
    return `Review add-on portions for ${readableFoodName(missingAddOnGrams.displayName)} before logging. Each sauce, topping, or add-on needs grams greater than 0.`;
  }

  return undefined;
}

function isItemReadyForLogging(item: MealAnalysisItem, review: ItemReviewState | undefined) {
  const grams = parsePositiveNumber(review?.grams) || item.servingGrams;
  return Boolean(review?.identityConfirmed && review.preparationMethod && grams > 0);
}

function prepDetailSummary(review: ItemReviewState) {
  return [
    prepDetailText("skin on", review.skinOn),
    prepDetailText("bone-in", review.boneIn),
    prepDetailText("sauce/dressing", review.sauceOrCondiment),
    prepDetailText("cheese/sugar", review.cheeseOrSugar),
  ]
    .filter(Boolean)
    .join(", ");
}

function prepDetailText(label: string, value?: PrepDetailValue) {
  if (!value || value === "not_sure") {
    return undefined;
  }

  return `${label}: ${value === "yes" ? "yes" : "no"}`;
}

function MessageCard({ title, body, tone }: { title: string; body: string; tone: "review" | "ready" }) {
  return (
    <InlineNotice title={title} body={body} tone={tone === "review" ? "warning" : "success"} />
  );
}

function roundMacro(value: number) {
  return Math.round(value * 10) / 10;
}

function parsePositiveNumber(value: string | undefined) {
  const parsed = Number((value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function adjustedNutrients(
  item: MealAnalysisItem,
  grams: number,
  addedOilGrams = 0,
  replacement?: FoodSearchResult,
  addOns: AddOnReview[] = []
): NutrientPer100g {
  const scale = item.servingGrams > 0 ? grams / item.servingGrams : 1;
  const oilCalories = Math.max(0, addedOilGrams) * 9;
  const baseNutrients = replacement
    ? scalePer100gNutrients(replacement.nutrientsPer100g, grams)
    : {
        caloriesKcal: item.nutrients.caloriesKcal * scale,
        proteinGrams: item.nutrients.proteinGrams * scale,
        carbohydrateGrams: item.nutrients.carbohydrateGrams * scale,
        fatGrams: item.nutrients.fatGrams * scale,
        fiberGrams: scaleOptional(item.nutrients.fiberGrams, scale),
        sugarGrams: scaleOptional(item.nutrients.sugarGrams, scale),
        sodiumMilligrams: scaleOptional(item.nutrients.sodiumMilligrams, scale),
      };

  const addOnTotals = addOns.reduce<NutrientPer100g>(
    (total, addOn) => {
      const addOnGrams = parsePositiveNumber(addOn.grams);
      return addNutrients(total, scalePer100gNutrients(addOn.food.nutrientsPer100g, addOnGrams));
    },
    zeroNutrients()
  );
  const withOil = {
    ...baseNutrients,
    caloriesKcal: baseNutrients.caloriesKcal + oilCalories,
    fatGrams: baseNutrients.fatGrams + Math.max(0, addedOilGrams),
  };

  return addNutrients(withOil, addOnTotals);
}

function scalePer100gNutrients(nutrients: NutrientPer100g, grams: number): NutrientPer100g {
  const scale = Math.max(grams, 0) / 100;
  return {
    caloriesKcal: nutrients.caloriesKcal * scale,
    proteinGrams: nutrients.proteinGrams * scale,
    carbohydrateGrams: nutrients.carbohydrateGrams * scale,
    fatGrams: nutrients.fatGrams * scale,
    fiberGrams: scaleOptional(nutrients.fiberGrams, scale),
    sugarGrams: scaleOptional(nutrients.sugarGrams, scale),
    sodiumMilligrams: scaleOptional(nutrients.sodiumMilligrams, scale),
  };
}

function addNutrients(left: NutrientPer100g, right: NutrientPer100g): NutrientPer100g {
  return {
    caloriesKcal: left.caloriesKcal + right.caloriesKcal,
    proteinGrams: left.proteinGrams + right.proteinGrams,
    carbohydrateGrams: left.carbohydrateGrams + right.carbohydrateGrams,
    fatGrams: left.fatGrams + right.fatGrams,
    fiberGrams: (left.fiberGrams ?? 0) + (right.fiberGrams ?? 0),
    sugarGrams: (left.sugarGrams ?? 0) + (right.sugarGrams ?? 0),
    sodiumMilligrams: (left.sodiumMilligrams ?? 0) + (right.sodiumMilligrams ?? 0),
  };
}

function zeroNutrients(): NutrientPer100g {
  return {
    caloriesKcal: 0,
    proteinGrams: 0,
    carbohydrateGrams: 0,
    fatGrams: 0,
    fiberGrams: 0,
    sugarGrams: 0,
    sodiumMilligrams: 0,
  };
}

function defaultAddOnGrams(food: FoodSearchResult) {
  const unit = food.servingSizeUnit?.toLowerCase();

  if (food.servingSize && unit && ["g", "gram", "grams"].includes(unit)) {
    return Math.max(1, Math.round(food.servingSize));
  }

  return 15;
}

function sumAdjustedNutrients(
  items: MealAnalysisItem[],
  itemReviews: Record<string, ItemReviewState>
): NutrientPer100g {
  return items.reduce<NutrientPer100g>(
    (total, item) => {
      const review = itemReviews[item.id] ?? {};
      const grams = parsePositiveNumber(review.grams) || item.servingGrams;
      const nutrients = adjustedNutrients(
        item,
        grams,
        parsePositiveNumber(review.addedOilGrams),
        review.replacement,
        review.addOns ?? []
      );
      return {
        caloriesKcal: total.caloriesKcal + nutrients.caloriesKcal,
        proteinGrams: total.proteinGrams + nutrients.proteinGrams,
        carbohydrateGrams: total.carbohydrateGrams + nutrients.carbohydrateGrams,
        fatGrams: total.fatGrams + nutrients.fatGrams,
        fiberGrams: (total.fiberGrams ?? 0) + (nutrients.fiberGrams ?? 0),
        sugarGrams: (total.sugarGrams ?? 0) + (nutrients.sugarGrams ?? 0),
        sodiumMilligrams: (total.sodiumMilligrams ?? 0) + (nutrients.sodiumMilligrams ?? 0),
      };
    },
    {
      caloriesKcal: 0,
      proteinGrams: 0,
      carbohydrateGrams: 0,
      fatGrams: 0,
      fiberGrams: 0,
      sugarGrams: 0,
      sodiumMilligrams: 0,
    }
  );
}

function scaleOptional(value: number | undefined, scale: number) {
  return value === undefined ? undefined : value * scale;
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
  emptyState: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
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
  preview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceAlt,
  },
  panel: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  summaryCard: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  summaryHeader: {
    flexDirection: "row",
    gap: spacing.md,
  },
  summaryCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  summaryTitle: {
    ...typography.display,
    color: colors.ink,
  },
  macroGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  macroTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  macroValue: {
    ...typography.heading,
  },
  macroLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  itemCard: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  itemCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  itemMeta: {
    ...typography.caption,
    color: colors.muted,
  },
  replacementMeta: {
    ...typography.caption,
    color: colors.green,
  },
  replacementPanel: {
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  replacementHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  candidatePanel: {
    gap: spacing.xs,
  },
  candidateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  candidateChip: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  candidateChipText: {
    ...typography.button,
    color: colors.green,
  },
  replacementSelection: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  replacementTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  clearReplacementButton: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  clearReplacementButtonText: {
    ...typography.button,
    color: colors.coral,
  },
  replacementSearchStack: {
    gap: spacing.sm,
  },
  replacementResult: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  addOnPanel: {
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  addOnResult: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  addOnAddText: {
    ...typography.button,
    color: colors.green,
  },
  addOnList: {
    gap: spacing.sm,
  },
  addOnRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  addOnGramInput: {
    width: 72,
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background,
    color: colors.ink,
    textAlign: "center",
  },
  reviewActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reviewButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  activeReviewButton: {
    backgroundColor: colors.green,
  },
  reviewButtonText: {
    ...typography.button,
    color: colors.green,
  },
  activeReviewButtonText: {
    color: colors.white,
  },
  dangerReviewButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: "#F8E3DC",
  },
  dangerReviewButtonText: {
    ...typography.button,
    color: colors.coral,
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
  notesInput: {
    minHeight: 86,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  preparationPanel: {
    gap: spacing.sm,
  },
  preparationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  preparationChip: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  activePreparationChip: {
    backgroundColor: colors.green,
  },
  preparationChipText: {
    ...typography.caption,
    color: colors.ink,
  },
  activePreparationChipText: {
    color: colors.white,
  },
  prepDetailStack: {
    gap: spacing.sm,
  },
  prepDetailRow: {
    gap: spacing.xs,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  prepDetailLabel: {
    ...typography.caption,
    color: colors.ink,
    fontWeight: "700",
  },
  prepDetailOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  prepDetailChip: {
    minHeight: 38,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
  },
  activePrepDetailChip: {
    backgroundColor: colors.green,
  },
  prepDetailChipText: {
    ...typography.caption,
    color: colors.ink,
  },
  activePrepDetailChipText: {
    color: colors.white,
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
  compactMacros: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  compactMacro: {
    ...typography.caption,
    color: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceAlt,
  },
  statusPill: {
    ...typography.caption,
    overflow: "hidden",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  readyPill: {
    color: colors.green,
    backgroundColor: colors.surfaceAlt,
  },
  reviewPill: {
    color: colors.coral,
    backgroundColor: "#F7E3DB",
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
    backgroundColor: colors.surfaceAlt,
  },
  inlineSourceButton: {
    minHeight: 36,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  sourceButtonText: {
    ...typography.button,
    color: colors.green,
  },
  cameraReportPanel: {
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  reportForm: {
    gap: spacing.sm,
  },
  reportTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  reportTypeChip: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  activeReportTypeChip: {
    backgroundColor: colors.green,
  },
  reportTypeText: {
    ...typography.button,
    color: colors.ink,
  },
  activeReportTypeText: {
    color: colors.white,
  },
  noteText: {
    ...typography.caption,
    color: colors.coral,
  },
  removedList: {
    gap: spacing.sm,
  },
  messageCard: {
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  reviewCard: {
    backgroundColor: "#F7E3DB",
  },
  readyCard: {
    backgroundColor: colors.surfaceAlt,
  },
  messageTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  progressRail: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: {
    width: "68%",
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: colors.lime,
  },
  actionRow: {
    gap: spacing.sm,
  },
  flexAction: {
    width: "100%",
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
    minHeight: 50,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
  },
  secondaryButtonText: {
    ...typography.button,
    color: colors.ink,
  },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  textButtonLabel: {
    ...typography.button,
    color: colors.green,
  },
});
