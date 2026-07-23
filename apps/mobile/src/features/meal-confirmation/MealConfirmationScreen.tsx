import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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
  MealAnalysisJob,
  MealCreate,
  NutrientPer100g,
} from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api, getStoredUserId } from "../../services/api";
import { queueConfirmedMeal } from "../../services/offlineMealQueue";
import {
  clearPendingAnalysisJob,
  loadPendingAnalysisJob,
  savePendingAnalysisJob,
} from "../../services/pendingAnalysisJob";
import {
  ActionButton,
  Card,
  InlineNotice,
  MacroStatTile,
  QuantityStepper,
  readableFoodName,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { useAnalysisDraftStore } from "../../stores/analysisDraftStore";
import { foodDetailHref } from "../food-detail/foodDetailLinks";
import { mealCreateIdempotencyKey } from "../../shared/domain/mealIdempotency";
import { presentApiError } from "../../shared/domain/apiErrorPresentation";
import { canQueueConfirmedMeal } from "../../shared/domain/offlineMealSync";
import { blocksFoodLogging, foodQualityDisplay } from "../../shared/domain/foodQuality";

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

type SaveNotice = {
  title: string;
  body: string;
  tone: "warning" | "danger";
  queued?: boolean;
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

const addOnSearchSuggestions = [
  { label: "Dressing", query: "dressing" },
  { label: "Cheese", query: "cheese" },
  { label: "Avocado", query: "avocado" },
  { label: "Butter", query: "butter" },
] as const;

export function MealConfirmationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
  const [itemReviews, setItemReviews] = useState<Record<string, ItemReviewState>>({});
  const [extraItems, setExtraItems] = useState<MealAnalysisItem[]>([]);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [mealSaved, setMealSaved] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0);
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [analysisJobId, setAnalysisJobId] = useState<string>();
  const [pendingJobChecked, setPendingJobChecked] = useState(false);
  const [keepScanPhotos, setKeepScanPhotos] = useState(false);
  const abandonedJobIds = useRef(new Set<string>());
  const startedAnalysisAttempt = useRef<number | undefined>(undefined);
  const draftPhoto = useAnalysisDraftStore((store) => store.draftPhoto);
  const draftPhotos = useAnalysisDraftStore((store) => store.draftPhotos);
  const referencePlateDiameterMm = useAnalysisDraftStore((store) => store.referencePlateDiameterMm);
  const clearDraft = useAnalysisDraftStore((store) => store.clearDraft);
  // Retain compatibility with a single legacy draft while favoring the bounded multi-view draft.
  const analysisPhotos =
    draftPhotos.length && draftPhotos[0]?.uri === draftPhoto?.uri
      ? draftPhotos
      : draftPhoto
        ? [draftPhoto]
        : [];
  const analyzableImages = analysisPhotos
    .map((photo) => photo.base64)
    .filter((photo): photo is string => Boolean(photo));
  const analysisKey = [
    ...analysisPhotos.map((photo) => photo.uri),
    referencePlateDiameterMm ? `plate:${referencePlateDiameterMm}` : undefined,
  ]
    .filter(Boolean)
    .join("|");
  const selectedPreview = analysisPhotos[selectedPreviewIndex] ?? analysisPhotos[0];
  const analysisIdempotencyKey = `meal-analysis:${stableAnalysisKey(analysisKey)}`;
  const createAnalysisJob = useMutation({
    mutationFn: () =>
      api.createMealAnalysisJob({
        imageBase64: analyzableImages[0],
        imagesBase64: analyzableImages,
        ...(referencePlateDiameterMm ? { referencePlateDiameterMm } : {}),
        idempotencyKey: analysisIdempotencyKey,
      }),
    retry: false,
  });
  useEffect(() => {
    if (
      !analyzableImages.length ||
      analysisJobId ||
      createAnalysisJob.isPending ||
      createAnalysisJob.error ||
      startedAnalysisAttempt.current === analysisAttempt
    ) {
      return;
    }
    startedAnalysisAttempt.current = analysisAttempt;
    createAnalysisJob.mutate(undefined, {
      onSuccess: (job) => {
        if (abandonedJobIds.current.has(job.id)) {
          void api.cancelMealAnalysisJob(job.id).catch(() => undefined);
          return;
        }
        setAnalysisJobId(job.id);
        void getStoredUserId()
          .then((ownerId) => (ownerId ? savePendingAnalysisJob(ownerId, job.id) : undefined))
          .catch(() => undefined);
      },
    });
  }, [analysisAttempt, analysisJobId, analysisKey, analyzableImages.length, createAnalysisJob]);

  useEffect(() => {
    if (analysisPhotos.length || analysisJobId) {
      setPendingJobChecked(true);
      return;
    }
    let mounted = true;
    void getStoredUserId()
      .then(async (ownerId) => (ownerId ? loadPendingAnalysisJob(ownerId) : undefined))
      .then((jobId) => {
        if (mounted && jobId) {
          setAnalysisJobId(jobId);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setPendingJobChecked(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [analysisJobId, analysisPhotos.length]);

  const analysisJob = useQuery({
    queryKey: ["meal-analysis-job", analysisJobId],
    queryFn: () => api.getMealAnalysisJob(analysisJobId ?? ""),
    enabled: Boolean(analysisJobId),
    retry: false,
    refetchInterval: (query) =>
      isTerminalAnalysisJob(query.state.data as MealAnalysisJob | undefined) ? false : 1_250,
  });
  const analysisResult = analysisJob.data?.result;
  const imageRetentionPreference = useQuery({
    queryKey: ["preferences"],
    queryFn: () => api.getPreferences(),
    enabled: Boolean(analysisJobId && analysisResult),
    retry: 1,
  });
  const retentionDays = imageRetentionPreference.data?.imageRetentionDays;
  const canKeepScanPhotos = typeof retentionDays === "number" && retentionDays > 0;
  const analysisIsLoading =
    createAnalysisJob.isPending ||
    !analysisJobId ||
    analysisJob.isLoading ||
    analysisJob.data?.status === "queued" ||
    analysisJob.data?.status === "processing";
  const jobFailure = analysisJob.data && isFailedAnalysisJob(analysisJob.data)
    ? analysisFailureCopy(analysisJob.data)
    : undefined;
  const analysisError = createAnalysisJob.error ?? analysisJob.error;
  const presentedAnalysisError = analysisError
    ? presentApiError(
        analysisError,
        "We couldn't analyze this meal right now. Try again in a moment."
      )
    : undefined;
  const logMutation = useMutation({
    mutationFn: ({ meal, idempotencyKey }: { meal: MealCreate; idempotencyKey: string }) =>
      api.createMeal(meal, { idempotencyKey }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["diary"] });
      await queryClient.invalidateQueries({ queryKey: ["foods", "recent"] });
      await clearPendingAnalysisJob(analysisJobId).catch(() => undefined);
      clearDraft();
      setMealSaved(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    onError: async (error, variables) => {
      // A temporary private scan may expire before a later sync. Do not claim
      // to retain it when a confirmed meal must be queued offline instead.
      if (canQueueConfirmedMeal(error) && !variables.meal.retainAnalysisImages) {
        const ownerId = await getStoredUserId();

        if (ownerId) {
          try {
            await queueConfirmedMeal(ownerId, variables.meal, variables.idempotencyKey);
            await queryClient.invalidateQueries({ queryKey: ["offline-meal-queue"] });
            setSaveNotice({
              title: "Confirmed meal queued",
              body: "We could not reach Living Nutrition, so this reviewed meal is saved on this device and will stay in your queue until you sync it from Today.",
              tone: "warning",
              queued: true,
            });
            return;
          } catch {
            // Keep the ordinary recovery message when device storage is unavailable.
          }
        }
      }

      setSaveNotice({
        title: "Meal was not saved",
        body: presentApiError(error, "We couldn't save this meal right now. Try again in a moment.").body,
        tone: "danger",
      });
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
      setSaveNotice({ title: "Meal needs review", body: validationMessage, tone: "danger" });
      return;
    }

    Keyboard.dismiss();
    setSaveNotice(null);
    const confirmedMeal = createMealFromAnalysis(meal, activeItems, itemReviews);
    logMutation.mutate({
      meal: {
        ...confirmedMeal,
        ...(analysisJobId ? { analysisJobId } : {}),
        retainAnalysisImages: Boolean(analysisJobId && keepScanPhotos && canKeepScanPhotos),
      },
      idempotencyKey: mealCreateIdempotencyKey(meal.id, confirmedMeal),
    });
  }

  function retakePhoto() {
    if (analysisJobId) {
      abandonedJobIds.current.add(analysisJobId);
      void api.cancelMealAnalysisJob(analysisJobId).catch(() => undefined);
      void clearPendingAnalysisJob(analysisJobId).catch(() => undefined);
    }
    void queryClient.cancelQueries({ queryKey: ["meal-analysis-job", analysisJobId] });
    clearDraft();
    router.replace("/camera");
  }

  function retryAnalysis() {
    void clearPendingAnalysisJob(analysisJobId).catch(() => undefined);
    createAnalysisJob.reset();
    startedAnalysisAttempt.current = undefined;
    setAnalysisJobId(undefined);
    setAnalysisAttempt((current) => current + 1);
  }

  if (mealSaved) {
    return <MealSavedScreen onViewToday={() => router.replace("/")} />;
  }

  if (!analysisPhotos[0]?.uri && !analysisJobId && !pendingJobChecked) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.eyebrow, themed.muted]}>Restoring scan</Text>
          <Text style={[styles.title, themed.ink]}>Checking your meal analysis.</Text>
          <Text style={[styles.body, themed.muted]}>Your photo is not kept on this device while we restore the safe review status.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!analysisPhotos[0]?.uri && !analysisJobId) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.emptyState}>
          <Text style={[styles.eyebrow, themed.muted]}>No photo</Text>
          <Text style={[styles.title, themed.ink]}>Start with a meal photo.</Text>
          <Text style={[styles.body, themed.muted]}>Use the camera so we can identify foods and match USDA records.</Text>
          <Link href="/camera" asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open camera to photograph a meal"
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Open camera</Text>
            </Pressable>
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
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
                <Text style={[styles.eyebrow, themed.muted]}>{analysisResult?.status === "ready" ? "Ready to log" : "Scan result"}</Text>
                <Text style={[styles.title, themed.ink]}>
                  {analysisResult?.mealName || (analysisIsLoading ? "Analyzing your meal." : "Meal estimate")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={analysisIsLoading ? "Cancel meal analysis and return to camera" : "Retake meal photo"}
                style={styles.textButton}
                onPress={retakePhoto}
              >
                <Text style={[styles.textButtonLabel, themed.actionText]}>
                  {analysisIsLoading ? "Cancel" : "Retake"}
                </Text>
              </Pressable>
            </View>

            <View style={styles.previewWrap}>
              {selectedPreview?.uri ? (
                <Image
                  accessibilityLabel={`Meal photo ${Math.min(selectedPreviewIndex + 1, analysisPhotos.length)} of ${analysisPhotos.length}`}
                  source={{ uri: selectedPreview.uri }}
                  style={[styles.preview, themed.subsurface]}
                />
              ) : (
                <View accessible accessibilityLabel="Restored meal analysis without a local photo" style={[styles.previewUnavailable, themed.subsurface]}>
                  <Ionicons name="shield-checkmark-outline" size={26} color={palette.actionText} />
                  <Text style={[styles.previewUnavailableText, themed.muted]}>Review restored. The original photo is not kept on this device.</Text>
                </View>
              )}
              <View style={styles.previewCount}>
                <Text style={styles.previewCountText}>
                  {analysisJob.data?.imageCount ?? analysisPhotos.length} {
                    (analysisJob.data?.imageCount ?? analysisPhotos.length) === 1 ? "view" : "views"
                  } reviewed
                </Text>
              </View>
            </View>
            {analysisPhotos.length > 1 ? (
              <View
                accessible
                accessibilityLabel={`${analysisPhotos.length} meal photos are available for review`}
                style={styles.photoSelector}
              >
                <Text style={[styles.photoSelectorLabel, themed.muted]}>Photos used in this review</Text>
                <View style={styles.photoSelectorRow}>
                  {analysisPhotos.map((photo, index) => (
                    <Pressable
                      key={photo.uri}
                      accessibilityRole="button"
                      accessibilityLabel={`Show meal photo ${index + 1} of ${analysisPhotos.length}`}
                      accessibilityState={{ selected: index === selectedPreviewIndex }}
                      onPress={() => setSelectedPreviewIndex(index)}
                      style={[
                        styles.photoSelectorItem,
                        index === selectedPreviewIndex
                          ? [styles.photoSelectorItemSelected, themed.selectedPhoto, { borderColor: palette.ink }]
                          : { borderColor: palette.border },
                      ]}
                    >
                      <Image source={{ uri: photo.uri }} style={styles.photoSelectorImage} />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.photoSelectorCaption,
                          { color: index === selectedPreviewIndex ? palette.ink : palette.muted },
                        ]}
                      >
                        View {index + 1}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.viewContext, themed.muted]}>
                  Multiple angles can clarify visible foods. They cannot confirm hidden oils, sauces, or exact portions.
                </Text>
              </View>
            ) : null}

            {saveNotice ? (
              <InlineNotice
                title={saveNotice.title}
                body={saveNotice.body}
                tone={saveNotice.tone}
                actions={
                  saveNotice.queued
                    ? [{ label: "Go to Today", onPress: () => router.replace("/"), variant: "secondary" }]
                    : undefined
                }
              />
            ) : null}

            {!analyzableImages.length && !analysisJobId ? (
              <MessageCard
                title="Photo data unavailable"
                body="This photo did not include analyzable image data. Retake it or import another photo."
                tone="review"
              />
            ) : null}

            {analysisIsLoading ? <AnalyzingCard imageCount={analysisPhotos.length} /> : null}

            {presentedAnalysisError || jobFailure ? (
              <MessageCard
                title={presentedAnalysisError?.isNetworkIssue ? "API connection failed" : "Analysis failed"}
                body={presentedAnalysisError?.body ?? jobFailure ?? "We couldn't analyze this meal right now."}
                tone="review"
                onRetry={retryAnalysis}
              />
            ) : null}

            {analysisResult ? (
              <>
                <ResultSummary
                  meal={analysisResult}
                  items={activeAnalysisItems(analysisResult.items, extraItems, itemReviews)}
                  itemReviews={itemReviews}
                />

                {analysisJobId ? (
                  <Card tone="soft">
                    <Text style={[styles.sectionTitle, themed.ink]}>Scan-photo privacy</Text>
                    <Text style={[styles.body, themed.muted]}>
                      Scan photos are deleted after you log this meal unless you choose to keep them. Keeping a photo is optional and never used for model training without separate permission.
                    </Text>
                    {imageRetentionPreference.isLoading ? (
                      <Text style={[styles.sourceText, themed.muted]}>Loading your retention preference...</Text>
                    ) : null}
                    {imageRetentionPreference.isError ? (
                      <InlineNotice
                        title="Photo preference unavailable"
                        body="The meal can still be logged without keeping its scan photos. Retry to load this optional preference."
                        tone="warning"
                        actions={[{ label: "Retry", onPress: () => void imageRetentionPreference.refetch(), variant: "secondary" }]}
                      />
                    ) : null}
                    {imageRetentionPreference.data ? (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityLabel="Keep scan photos with this saved meal"
                        accessibilityHint={
                          canKeepScanPhotos
                            ? `Keeps this meal's private scan photos for ${retentionDays} days, then deletes them automatically.`
                            : "This is unavailable because your retention preference is set to zero days."
                        }
                        accessibilityState={{ checked: keepScanPhotos, disabled: !canKeepScanPhotos }}
                        disabled={!canKeepScanPhotos}
                        onPress={() => setKeepScanPhotos((current) => !current)}
                        style={[
                          styles.photoPrivacyChoice,
                          keepScanPhotos ? themed.selectedPhoto : themed.subsurface,
                          !canKeepScanPhotos ? styles.photoPrivacyChoiceDisabled : undefined,
                        ]}
                      >
                        <Ionicons
                          name={keepScanPhotos ? "checkbox" : "square-outline"}
                          size={22}
                          color={keepScanPhotos ? palette.actionText : palette.muted}
                        />
                        <View style={styles.photoPrivacyCopy}>
                          <Text style={[styles.photoPrivacyTitle, themed.ink]}>
                            {canKeepScanPhotos
                              ? `Keep these private scan photos for ${retentionDays} ${retentionDays === 1 ? "day" : "days"}`
                              : "Photo retention is set to immediate deletion"}
                          </Text>
                          <Text style={[styles.sourceText, themed.muted]}>
                            {canKeepScanPhotos
                              ? "You can delete a kept photo from the saved meal. It is not public."
                              : "Change this in Data Controls before saving if you want to keep a scan photo."}
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                  </Card>
                ) : null}

                <View style={styles.panel}>
                  <Text style={[styles.sectionTitle, themed.ink]}>Detected foods</Text>
                  {activeAnalysisItems(analysisResult.items, extraItems, itemReviews).map((item) => (
                    <FoodItemCard
                      key={item.id}
                      item={item}
                      review={itemReviews[item.id] ?? {}}
                      imageCount={analysisResult.imageCount}
                      onChangeReview={(patch) => updateItemReview(item.id, patch)}
                      onDuplicate={() => duplicateItem(item)}
                      onSplit={() => splitItem(item)}
                    />
                  ))}
                  <RemovedItemsList
                    items={removedAnalysisItems(analysisResult.items, extraItems, itemReviews)}
                    itemReviews={itemReviews}
                    onRestore={restoreItem}
                  />
                </View>

                <View style={styles.actionRow}>
                  <ActionButton
                    label={
                      logMutation.isPending
                        ? "Saving..."
                        : analysisResult.status === "ready"
                          ? "Log meal"
                          : "Log estimate"
                    }
                    onPress={() => logResult(analysisResult)}
                    disabled={logMutation.isPending}
                    style={styles.flexAction}
                  />
                  <Link href="/manual-search" asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Search for a food record manually instead"
                      style={[styles.secondaryButton, themed.subsurface]}
                    >
                      <Text style={[styles.secondaryButtonText, themed.ink]}>Search instead</Text>
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

function MealSavedScreen({ onViewToday }: { onViewToday: () => void }) {
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.savedState}>
        <View accessible accessibilityLabel="Meal saved" style={[styles.savedMark, themed.savedMark]}>
          <Ionicons name="checkmark" size={32} color={colors.white} />
        </View>
        <Text style={[styles.eyebrow, themed.actionText]}>Saved to your diary</Text>
        <Text style={[styles.title, themed.ink]}>Meal saved.</Text>
        <Text style={[styles.body, themed.muted]}>
          Your diary uses the food sources and portions you confirmed. You can adjust this meal later from Today.
        </Text>
        <ActionButton label="View Today" onPress={onViewToday} style={styles.savedAction} />
      </View>
    </SafeAreaView>
  );
}

function AnalyzingCard({ imageCount }: { imageCount: number }) {
  const stages = ["Identifying foods", "Estimating portions", "Matching nutrition data", "Preparing your review"];
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);

  return (
    <Card tone="insight">
      <Text style={[styles.messageTitle, themed.ink]}>Review is on the way</Text>
      <Text style={[styles.body, themed.muted]}>
        {imageCount > 1
          ? `${imageCount} views help us compare visible foods before we match provider records. You still confirm every portion.`
          : "We identify visible foods first, then match provider records. AI never supplies the final nutrition values."}
      </Text>
      <View accessibilityLabel="Meal analysis stages" style={styles.analysisStages}>
        {stages.map((stage, index) => (
          <View key={stage} style={styles.analysisStage}>
            <View style={[styles.stageDot, themed.stageDot, index === 0 ? styles.stageDotActive : undefined]} />
            <Text style={[styles.stageText, { color: index === 0 ? colors.insight : palette.muted }]}>{stage}</Text>
          </View>
        ))}
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
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);

  return (
    <Card>
      <View style={styles.summaryHeader}>
        <View style={styles.summaryCopy}>
          <StatusPill
            label={isReady ? "Ready to log" : "Needs confirmation"}
            tone={isReady ? "success" : "warning"}
          />
          <Text style={[styles.summaryTitle, themed.ink]}>{Math.round(totals.caloriesKcal)} kcal</Text>
          <Text style={[styles.body, themed.muted]}>
            Estimated from the scan, then recalculated from the food, preparation, oil, and grams you confirm below.
          </Text>
          {meal.referencePlateDiameterMm ? (
            <Text style={[styles.sourceText, themed.muted]}>
              Optional plate reference: about {formatPlateDiameter(meal.referencePlateDiameterMm)} across. It was used only as a visual cue; confirm grams below.
            </Text>
          ) : null}
          <Text style={[styles.sourceText, themed.muted]}>
            {reviewCount} of {items.length} foods reviewed for logging.
          </Text>
        </View>
      </View>
      <View style={styles.macroGrid}>
        <MacroStatTile label="Protein" value={roundMacro(totals.proteinGrams)} suffix="g" tone="protein" />
        <MacroStatTile label="Carbs" value={roundMacro(totals.carbohydrateGrams)} suffix="g" tone="carbs" />
        <MacroStatTile label="Fat" value={roundMacro(totals.fatGrams)} suffix="g" tone="fat" />
      </View>
      {meal.summary ? <Text style={[styles.sourceText, themed.muted]}>{meal.summary}</Text> : null}
    </Card>
  );
}

function FoodItemCard({
  item,
  review,
  imageCount,
  onChangeReview,
  onDuplicate,
  onSplit,
}: {
  item: MealAnalysisItem;
  review: ItemReviewState;
  imageCount: number;
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
  const selectedFoodQuality = review.replacement?.qualityAssessment ?? item.qualityAssessment;
  const selectedFoodQualityDisplay = foodQualityDisplay(selectedFoodQuality);
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
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
          <Text numberOfLines={2} style={[styles.itemTitle, themed.ink]}>
            {readableFoodName(displayName)}
          </Text>
          <Text style={[styles.itemMeta, themed.muted]}>
            Detected as {item.detectedName} · {item.servingLabel} · {Math.round(item.servingGrams)}g
          </Text>
          {review.replacement ? (
            <Text style={[styles.replacementMeta, themed.actionText]}>
              User replacement selected from {review.replacement.provider.replaceAll("_", " ")}.
            </Text>
          ) : null}
        </View>
        <StatusPill
          label={itemReady ? "Reviewed" : "Needs review"}
          tone={itemReady ? "success" : "warning"}
        />
      </View>
      <View style={styles.badgeRow}>
        <SourceBadge label={provider.replaceAll("_", " ")} tone="success" />
        <StatusPill
          label={selectedFoodQualityDisplay.label}
          tone={selectedFoodQualityDisplay.tone}
        />
      </View>
      {selectedFoodQuality?.isBlocking ? (
        <InlineNotice
          title="Choose a different food record"
          body={selectedFoodQuality.summary}
          tone="danger"
        />
      ) : null}
      <ScanCuePanel item={item} />
      <ViewEvidencePanel evidence={item.viewEvidence} imageCount={imageCount} />
      <View style={styles.reviewActionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${review.identityConfirmed ? "Unconfirm" : "Confirm"} ${readableFoodName(displayName)}`}
          accessibilityState={{ selected: Boolean(review.identityConfirmed) }}
          style={[styles.reviewButton, themed.subsurface, review.identityConfirmed ? styles.activeReviewButton : undefined]}
          onPress={() => onChangeReview({ identityConfirmed: !review.identityConfirmed })}
        >
          <Text style={[styles.reviewButtonText, review.identityConfirmed ? { color: palette.onPrimary } : themed.actionText]}>
            {review.identityConfirmed ? "Food confirmed" : "Confirm this food"}
          </Text>
        </Pressable>
        <Link href="/manual-search" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Search for a replacement food manually instead of ${readableFoodName(displayName)}`}
            style={[styles.reviewButton, themed.subsurface]}
          >
            <Text style={[styles.reviewButtonText, themed.actionText]}>Manual search fallback</Text>
          </Pressable>
        </Link>
      </View>
      <FoodReplacementSearch
        item={item}
        imageCount={imageCount}
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
          <Text style={[styles.inputLabel, themed.muted]}>Confirm weight in grams</Text>
          <TextInput
            accessibilityLabel={`Confirm weight in grams for ${readableFoodName(displayName)}`}
          style={[styles.amountInput, themed.input]}
          value={confirmedGrams}
          onChangeText={(value) => onChangeReview({ grams: value })}
          accessibilityHint="Enter the weight you ate in grams. Macros recalculate from the provider record."
            keyboardType="decimal-pad"
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={[styles.servingHint, themed.subsurface]}>
          <Text style={[styles.servingHintValue, themed.ink]}>{Math.round(grams)}g</Text>
          <Text style={[styles.servingHintLabel, themed.muted]}>used</Text>
        </View>
      </View>
      <QuantityStepper
        label={`weight for ${readableFoodName(displayName)}`}
        value={grams}
        step={25}
        min={1}
        onValueChange={(nextGrams) => onChangeReview({ grams: String(nextGrams) })}
      />
      <Text style={[styles.sourceText, themed.muted]}>
        {imageCount > 1
          ? "Multiple views can clarify visible foods, but portions still need confirmation. Adjust grams if the scan looks off."
          : "This photo's portion estimate needs confirmation. Adjust grams if the scan looks off."}
      </Text>
      <FoodAddOnSearch
        addOns={addOns}
        onChangeAddOns={(nextAddOns) => onChangeReview({ addOns: nextAddOns })}
      />
      <View style={styles.preparationPanel}>
        <Text style={[styles.inputLabel, themed.muted]}>Preparation</Text>
        <View style={styles.preparationGrid}>
          {preparationOptions.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`Preparation: ${option.label}`}
              accessibilityState={{ selected: preparationMethod === option.value }}
              style={[
                styles.preparationChip,
                themed.subsurface,
                preparationMethod === option.value ? styles.activePreparationChip : undefined,
              ]}
              onPress={() => onChangeReview({ preparationMethod: option.value })}
            >
              <Text
                style={[
                  styles.preparationChipText,
                  { color: preparationMethod === option.value ? palette.onPrimary : palette.ink },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.preparationPanel}>
        <Text style={[styles.inputLabel, themed.muted]}>Hidden ingredient checks</Text>
        <Text style={[styles.sourceText, themed.muted]}>
          Photos cannot confirm these details. Pick what applies so the saved meal keeps your review context.
        </Text>
        <View style={styles.prepDetailStack}>
          {prepDetailQuestions.map((question) => (
            <View key={question.key} style={[styles.prepDetailRow, themed.input]}>
              <Text style={[styles.prepDetailLabel, themed.ink]}>{question.label}</Text>
              <View style={styles.prepDetailOptions}>
                {prepDetailOptions.map((option) => {
                  const active = (review[question.key] ?? "not_sure") === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityLabel={`${question.label} ${option.label}`}
                      accessibilityState={{ selected: active }}
                      style={[
                        styles.prepDetailChip,
                        themed.controlSurface,
                        active ? styles.activePrepDetailChip : undefined,
                      ]}
                      onPress={() => onChangeReview({ [question.key]: option.value })}
                    >
                      <Text
                        style={[
                          styles.prepDetailChipText,
                          { color: active ? palette.onPrimary : palette.ink },
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
          <Text style={[styles.inputLabel, themed.muted]}>Added oil or butter (grams)</Text>
          <TextInput
            accessibilityLabel={`Added oil or butter grams for ${readableFoodName(displayName)}`}
            style={[styles.amountInput, themed.input]}
            value={review.addedOilGrams ?? ""}
          onChangeText={(value) => onChangeReview({ addedOilGrams: value })}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={palette.muted}
          accessibilityHint="Enter only the grams of added oil or butter."
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={Keyboard.dismiss}
          />
        </View>
        <View style={[styles.servingHint, themed.subsurface]}>
          <Text style={[styles.servingHintValue, themed.ink]}>{Math.round(addedOilGrams * 9)}</Text>
          <Text style={[styles.servingHintLabel, themed.muted]}>oil kcal</Text>
        </View>
      </View>
      <QuantityStepper
        label={`added oil or butter for ${readableFoodName(displayName)}`}
        value={addedOilGrams}
        step={5}
        min={0}
        onValueChange={(nextGrams) => onChangeReview({ addedOilGrams: String(nextGrams) })}
      />
      <View style={styles.amountInputWrap}>
        <Text style={[styles.inputLabel, themed.muted]}>Sauces, toppings, or notes</Text>
        <TextInput
          accessibilityLabel={`Sauces, toppings, or notes for ${readableFoodName(displayName)}`}
          accessibilityHint="Optional notes are saved with this meal item."
          style={[styles.amountInput, styles.notesInput, themed.input]}
          value={review.notes ?? ""}
          onChangeText={(value) => onChangeReview({ notes: value })}
          placeholder="e.g. ranch dressing, cheese, skin removed"
          multiline
          returnKeyType="done"
        />
      </View>
      <View style={styles.compactMacros}>
        <Text style={[styles.compactMacro, themed.subsurface, themed.ink]}>{Math.round(nutrients.caloriesKcal)} kcal</Text>
        <Text style={[styles.compactMacro, themed.subsurface, themed.ink]}>{roundMacro(nutrients.proteinGrams)}g P</Text>
        <Text style={[styles.compactMacro, themed.subsurface, themed.ink]}>{roundMacro(nutrients.carbohydrateGrams)}g C</Text>
        <Text style={[styles.compactMacro, themed.subsurface, themed.ink]}>{roundMacro(nutrients.fatGrams)}g F</Text>
      </View>
      <View style={styles.badgeRow}>
        <SourceBadge label={provider.replaceAll("_", " ")} tone="success" />
        <SourceBadge label={dataType} />
      </View>
      <Link href={foodDetailHref(`${provider}:${externalId}`, { contextLabel: "Camera estimate source" })} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View nutrition source for ${readableFoodName(displayName)}`}
          style={[styles.sourceButton, themed.subsurface]}
        >
          <Text style={[styles.sourceButtonText, themed.actionText]}>View source</Text>
        </Pressable>
      </Link>
      <Text style={[styles.sourceText, themed.muted]}>{item.confidence.explanation}</Text>
      <View style={[styles.cameraReportPanel, themed.input]}>
        <View style={styles.reportHeader}>
          <View style={styles.itemCopy}>
            <Text style={[styles.inputLabel, themed.muted]}>Report this source match</Text>
            <Text style={[styles.sourceText, themed.muted]}>
              Use this if the camera matched the wrong food or the provider data looks off.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${reportOpen ? "Hide" : "Show"} source-match report options for ${readableFoodName(displayName)}`}
            accessibilityState={{ expanded: reportOpen }}
            style={[styles.reviewButton, themed.subsurface]}
            onPress={() => setReportOpen((current) => !current)}
          >
            <Text style={[styles.reviewButtonText, themed.actionText]}>{reportOpen ? "Hide report" : "Report"}</Text>
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
                    accessibilityLabel={`Report reason: ${option.label}`}
                    accessibilityState={{ selected: active }}
                    style={[styles.reportTypeChip, themed.controlSurface, active ? styles.activeReportTypeChip : undefined]}
                    onPress={() => setReportType(option.value)}
                  >
                    <Text style={[styles.reportTypeText, active ? styles.activeReportTypeText : themed.ink]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel={`Optional source-match report details for ${readableFoodName(displayName)}`}
              style={[styles.amountInput, styles.notesInput, themed.input]}
              value={reportMessage}
              onChangeText={setReportMessage}
              placeholder="Optional: what looks wrong about this source?"
              placeholderTextColor={palette.muted}
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
      {item.notes ? <Text style={[styles.noteText, themed.warningText]}>{item.notes}</Text> : null}
      <View style={styles.reviewActionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Duplicate ${readableFoodName(displayName)} for a separate portion`}
          style={[styles.reviewButton, themed.subsurface]}
          onPress={onDuplicate}
        >
          <Text style={[styles.reviewButtonText, themed.actionText]}>Duplicate</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Split ${readableFoodName(displayName)} into two portions`}
          style={[styles.reviewButton, themed.subsurface]}
          onPress={onSplit}
        >
          <Text style={[styles.reviewButtonText, themed.actionText]}>Split</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${readableFoodName(displayName)} from this meal review`}
          style={[styles.reviewButton, themed.subsurface]}
          onPress={() => onChangeReview({ removed: true, markedIncorrect: false })}
        >
          <Text style={[styles.reviewButtonText, themed.actionText]}>Remove</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark ${readableFoodName(displayName)} as an incorrect scan result and remove it`}
          style={[styles.dangerReviewButton, themed.dangerSurface]}
          onPress={() => onChangeReview({ removed: true, markedIncorrect: true })}
        >
          <Text style={[styles.dangerReviewButtonText, themed.dangerText]}>Mark incorrect</Text>
        </Pressable>
      </View>
    </Card>
  );
}

function ScanCuePanel({ item }: { item: MealAnalysisItem }) {
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
  const cues = cameraReviewCues(item);

  return (
    <View accessibilityRole="alert" style={[styles.scanCuePanel, themed.subsurface]}>
      <Text style={[styles.inputLabel, themed.muted]}>Scan cues to review</Text>
      <Text style={[styles.sourceText, themed.muted]}>{cues.portion}</Text>
      {cues.preparation ? <Text style={[styles.sourceText, themed.muted]}>{cues.preparation}</Text> : null}
      {cues.hiddenIngredients ? (
        <Text style={[styles.sourceText, themed.muted]}>{cues.hiddenIngredients}</Text>
      ) : null}
    </View>
  );
}

function ViewEvidencePanel({
  evidence,
  imageCount,
}: {
  evidence: MealAnalysisItem["viewEvidence"];
  imageCount: number;
}) {
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
  const tone = evidence.status === "conflicting" ? "danger" : evidence.status === "corroborated" ? "success" : "warning";
  const title =
    evidence.status === "corroborated"
      ? "Visible across views"
      : evidence.status === "conflicting"
        ? "Views need your choice"
        : evidence.status === "single_view"
          ? "One-view scan cue"
          : "Limited view evidence";

  return (
    <InlineNotice
      title={title}
      body={evidence.explanation}
      tone={tone}
      accessibilityLabel={`${title}. ${evidence.explanation} ${imageCount > 1 ? `${imageCount} views were submitted.` : "One view was submitted."}`}
    />
  );
}

function FoodReplacementSearch({
  item,
  imageCount,
  selectedReplacement,
  onSelectReplacement,
  onClearReplacement,
}: {
  item: MealAnalysisItem;
  imageCount: number;
  selectedReplacement?: FoodSearchResult;
  onSelectReplacement: (replacement: FoodSearchResult) => void;
  onClearReplacement: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [replacementQuery, setReplacementQuery] = useState("");
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
  const candidateLabels = item.candidateLabels.filter(
    (label) => label.trim() && label.trim().toLowerCase() !== item.displayName.toLowerCase()
  );
  const candidateFoods = (item.candidateFoods ?? []).filter(
    (food) => food.id !== selectedReplacement?.id
  );

  function candidateEvidenceLabel(label: string) {
    const support = item.viewEvidence.candidateEvidence.find(
      (evidence) => evidence.label.trim().toLowerCase() === label.trim().toLowerCase()
    )?.observedInViewIndexes.length;
    if (!support) return "No separate per-view support was returned.";
    return `Scan cue in ${support} of ${imageCount} submitted ${imageCount === 1 ? "view" : "views"}.`;
  }
  const replacementSearch = useQuery({
    queryKey: ["camera-replacement-search", item.id, replacementQuery.trim()],
    queryFn: () => api.searchFoods(replacementQuery.trim()),
    enabled: searchOpen && replacementQuery.trim().length >= 2,
  });

  return (
    <View style={[styles.replacementPanel, themed.input]}>
      <View style={styles.replacementHeader}>
        <View style={styles.itemCopy}>
          <Text style={[styles.inputLabel, themed.muted]}>Food identity</Text>
          <Text style={[styles.sourceText, themed.muted]}>
            Search replacement if the detected food is wrong or too generic.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${searchOpen ? "Hide" : "Show"} food replacement search for ${readableFoodName(item.displayName)}`}
          accessibilityState={{ expanded: searchOpen }}
          style={[styles.reviewButton, themed.subsurface]}
          onPress={() => setSearchOpen((current) => !current)}
        >
          <Text style={[styles.reviewButtonText, themed.actionText]}>{searchOpen ? "Hide search" : "Replace food"}</Text>
        </Pressable>
      </View>

      {candidateLabels.length ? (
        <View style={styles.candidatePanel}>
          <Text style={[styles.inputLabel, themed.muted]}>AI identity candidates</Text>
          <Text style={[styles.sourceText, themed.muted]}>
            These are review aids, not confirmed nutrition records. Suggestions with visible support from more submitted views appear first; pick a matching source before logging.
          </Text>
          <View style={styles.candidateRow}>
            {candidateLabels.map((label) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={`Search nutrition records for ${label}`}
                accessibilityHint={candidateEvidenceLabel(label)}
                style={[styles.candidateChip, themed.controlSurface]}
                onPress={() => {
                  setSearchOpen(true);
                  setReplacementQuery(label);
                }}
              >
                <Text style={[styles.candidateChipText, themed.actionText]}>{readableFoodName(label)}</Text>
                <Text style={[styles.candidateEvidenceText, themed.muted]}>{candidateEvidenceLabel(label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {candidateFoods.length ? (
        <View style={styles.candidateRecordPanel}>
          <Text style={[styles.inputLabel, themed.muted]}>Provider-backed alternatives</Text>
          <Text style={[styles.sourceText, themed.muted]}>
            These records follow the scan's alternate labels, including any visible multi-view support. Their order is a review aid, not a claim of accuracy; choose one only if it matches what you ate.
          </Text>
          <View style={styles.replacementSearchStack}>
            {candidateFoods.map((food) => (
              <Pressable
                key={food.id}
                accessibilityRole="button"
                accessibilityLabel={`Use suggested provider record ${readableFoodName(food.displayName)}`}
                accessibilityHint={`${Math.round(food.nutrientsPer100g.caloriesKcal)} calories per 100 grams from ${food.provider.replaceAll("_", " ")}. You still need to confirm the food and portion.`}
                style={[styles.replacementResult, themed.subsurface]}
                onPress={() => {
                  onSelectReplacement(food);
                  setSearchOpen(false);
                  setReplacementQuery("");
                }}
              >
                <View style={styles.itemCopy}>
                  <Text numberOfLines={2} style={[styles.replacementTitle, themed.ink]}>
                    {readableFoodName(food.displayName)}
                  </Text>
                  <Text numberOfLines={1} style={[styles.sourceText, themed.muted]}>
                    {Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g - {food.dataType}
                  </Text>
                </View>
                <StatusPill
                  label={foodQualityDisplay(food.qualityAssessment).label}
                  tone={foodQualityDisplay(food.qualityAssessment).tone}
                />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {selectedReplacement ? (
        <View style={[styles.replacementSelection, themed.subsurface]}>
          <View style={styles.itemCopy}>
            <Text style={[styles.replacementTitle, themed.ink]}>{readableFoodName(selectedReplacement.displayName)}</Text>
            <Text style={[styles.sourceText, themed.muted]}>
              {Math.round(selectedReplacement.nutrientsPer100g.caloriesKcal)} kcal per 100g -{" "}
              {selectedReplacement.provider.replaceAll("_", " ")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear the selected replacement ${readableFoodName(selectedReplacement.displayName)}`}
            style={[styles.clearReplacementButton, themed.subsurface]}
            onPress={onClearReplacement}
          >
            <Text style={[styles.clearReplacementButtonText, themed.dangerText]}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      {searchOpen ? (
        <View style={styles.replacementSearchStack}>
          <TextInput
            accessibilityLabel={`Search replacement nutrition records for ${readableFoodName(item.displayName)}`}
            accessibilityHint="Search for the food you ate, then select a provider-backed record."
            style={[styles.amountInput, themed.input]}
            value={replacementQuery}
            onChangeText={setReplacementQuery}
            placeholder={`Search instead of ${item.detectedName}`}
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit
          />
          {replacementSearch.isLoading ? (
            <Text style={[styles.sourceText, themed.muted]}>Searching nutrition records...</Text>
          ) : null}
          {replacementQuery.trim().length >= 2 && !replacementSearch.isLoading && !replacementSearch.data?.items.length ? (
            <Text style={[styles.noteText, themed.warningText]}>No replacement foods found yet. Try a simpler food name.</Text>
          ) : null}
          {(replacementSearch.data?.items ?? []).slice(0, 4).map((food) => (
            <Pressable
              key={food.id}
              accessibilityRole="button"
              accessibilityLabel={`Use ${readableFoodName(food.displayName)} as the replacement food`}
              accessibilityHint={`${Math.round(food.nutrientsPer100g.caloriesKcal)} calories per 100 grams from ${food.provider.replaceAll("_", " ")}.`}
              style={[styles.replacementResult, themed.subsurface]}
              onPress={() => {
                onSelectReplacement(food);
                setSearchOpen(false);
                setReplacementQuery("");
              }}
            >
              <View style={styles.itemCopy}>
                <Text numberOfLines={2} style={[styles.replacementTitle, themed.ink]}>
                  {readableFoodName(food.displayName)}
                </Text>
                <Text numberOfLines={1} style={[styles.sourceText, themed.muted]}>
                  {Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g - {food.dataType}
                </Text>
              </View>
              <StatusPill
                label={foodQualityDisplay(food.qualityAssessment).label}
                tone={foodQualityDisplay(food.qualityAssessment).tone}
              />
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
  const [expanded, setExpanded] = useState(false);
  const { palette } = useTheme();
  const themed = confirmationThemeStyles(palette);
  const addOnSearch = useQuery({
    queryKey: ["camera-addon-search", addOnQuery.trim()],
    queryFn: () => api.searchFoods(addOnQuery.trim()),
    enabled: addOnQuery.trim().length >= 2,
  });
  const favoriteAddOns = useQuery({
    queryKey: ["foods", "favorites", "camera-add-ons"],
    queryFn: () => api.getFavoriteFoods(8),
    enabled: expanded,
  });
  const recentAddOns = useQuery({
    queryKey: ["foods", "recent", "camera-add-ons"],
    queryFn: () => api.getRecentFoods(8),
    enabled: expanded,
  });
  const selectedFoodIds = new Set(addOns.map((addOn) => addOn.food.id));
  const favoriteAddOnItems = (favoriteAddOns.data?.items ?? []).filter(
    (food) => !selectedFoodIds.has(food.id)
  );
  const favoriteAddOnIds = new Set(favoriteAddOnItems.map((food) => food.id));
  const recentAddOnItems = (recentAddOns.data?.items ?? []).filter(
    (food) => !selectedFoodIds.has(food.id) && !favoriteAddOnIds.has(food.id)
  );
  const addOnSummary = addOns.reduce(
    (summary, addOn) => {
      const nutrients = scalePer100gNutrients(
        addOn.food.nutrientsPer100g,
        parsePositiveNumber(addOn.grams)
      );
      return {
        calories: summary.calories + nutrients.caloriesKcal,
        warningCount: summary.warningCount + (addOn.food.qualityFlags?.length ? 1 : 0),
      };
    },
    { calories: 0, warningCount: 0 }
  );
  const addOnsNeedingGrams = addOns.filter((addOn) => parsePositiveNumber(addOn.grams) <= 0).length;

  function addFood(food: FoodSearchResult) {
    onChangeAddOns([
      ...addOns,
      {
        id: `${food.id}-${Date.now()}`,
        food,
        // A source selection is not a confirmed portion. Keep this blank until
        // the user enters the grams actually used in the meal.
        grams: "",
      },
    ]);
    setAddOnQuery("");
    setExpanded(true);
  }

  function updateAddOn(addOnId: string, patch: Partial<AddOnReview>) {
    onChangeAddOns(
      addOns.map((addOn) => (addOn.id === addOnId ? { ...addOn, ...patch } : addOn))
    );
  }

  function removeAddOn(addOnId: string) {
    onChangeAddOns(addOns.filter((addOn) => addOn.id !== addOnId));
  }

  function moveAddOn(addOnId: string, direction: -1 | 1) {
    const currentIndex = addOns.findIndex((addOn) => addOn.id === addOnId);
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= addOns.length) {
      return;
    }

    const reordered = [...addOns];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    onChangeAddOns(reordered);
  }

  function addOnSummaryLabel() {
    if (addOnsNeedingGrams) {
      return `${addOns.length} add-on${addOns.length === 1 ? "" : "s"} · enter grams`;
    }

    return `${addOns.length} add-on${addOns.length === 1 ? "" : "s"} · ${Math.round(addOnSummary.calories)} kcal`;
  }

  function renderSavedAddOn(food: FoodSearchResult, collection: "favorite" | "recent") {
    const collectionLabel = collection === "favorite" ? "favorite" : "recent";
    return (
      <Pressable
        key={food.id}
        accessibilityRole="button"
        accessibilityLabel={`Add ${collectionLabel} add-on ${readableFoodName(food.displayName)}`}
        accessibilityHint="Selects this source record. Enter its grams before it counts toward this meal."
        style={[styles.addOnShortcut, themed.subsurface]}
        onPress={() => addFood(food)}
      >
        <Text numberOfLines={2} style={[styles.addOnShortcutText, themed.actionText]}>
          {readableFoodName(food.displayName)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.addOnPanel, themed.input]}>
      <View style={styles.addOnHeader}>
        <View style={styles.itemCopy}>
          <Text style={[styles.inputLabel, themed.muted]}>Sauces, toppings, or add-ons</Text>
          <Text style={[styles.sourceText, themed.muted]}>
            Add provider-backed records only when they should count toward this meal's macros.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? "Hide add-on management"
              : addOns.length
                ? "Manage meal add-ons"
                : "Add sauce, topping, or other provider-backed add-on"
          }
          accessibilityState={{ expanded }}
          style={[styles.reviewButton, themed.subsurface]}
          onPress={() => setExpanded((current) => !current)}
        >
          <Text style={[styles.reviewButtonText, themed.actionText]}>
            {expanded ? "Done" : addOns.length ? "Manage" : "Add add-on"}
          </Text>
        </Pressable>
      </View>
      {addOns.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            addOnsNeedingGrams
              ? `${addOns.length} add-on${addOns.length === 1 ? "" : "s"}; ${addOnsNeedingGrams} add-on${addOnsNeedingGrams === 1 ? " needs" : "s need"} grams before logging. ${expanded ? "Hide" : "Show"} add-on management.`
              : `${addOns.length} add-on${addOns.length === 1 ? "" : "s"}, ${Math.round(addOnSummary.calories)} calories. ${expanded ? "Hide" : "Show"} add-on management.`
          }
          accessibilityState={{ expanded }}
          style={[styles.addOnSummary, themed.subsurface]}
          onPress={() => setExpanded((current) => !current)}
        >
          <View style={styles.itemCopy}>
            <Text style={[styles.replacementTitle, themed.ink]}>
              {addOnSummaryLabel()}
            </Text>
            <Text style={[styles.sourceText, themed.muted]}>
              {addOnsNeedingGrams
                ? `${addOnsNeedingGrams} add-on${addOnsNeedingGrams === 1 ? " needs" : "s need"} an explicit gram amount before logging.`
                : addOnSummary.warningCount
                ? `${addOnSummary.warningCount} source warning${addOnSummary.warningCount === 1 ? "" : "s"} to review.`
                : "Provider records and grams are ready for review."}
            </Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={palette.actionText} />
        </Pressable>
      ) : null}
      {expanded ? (
        <>
          <View style={styles.addOnShortcutSection}>
            <Text style={[styles.sourceText, themed.muted]}>Start with a common add-on</Text>
            <View style={styles.addOnShortcutRow}>
              {addOnSearchSuggestions.map((suggestion) => (
                <Pressable
                  key={suggestion.query}
                  accessibilityRole="button"
                  accessibilityLabel={`Search provider-backed add-ons for ${suggestion.label.toLowerCase()}`}
                  accessibilityHint="Shows nutrition records. Select a record and confirm its grams before it counts toward this meal."
                  style={[styles.addOnShortcut, themed.subsurface]}
                  onPress={() => setAddOnQuery(suggestion.query)}
                >
                  <Text style={[styles.addOnShortcutText, themed.actionText]}>{suggestion.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {favoriteAddOnItems.length ? (
            <View style={styles.addOnShortcutSection}>
              <Text style={[styles.sourceText, themed.muted]}>Favorite add-ons</Text>
              <Text style={[styles.noteText, themed.muted]}>Choose a saved record, then enter the amount you used.</Text>
              <View style={styles.addOnShortcutRow}>
                {favoriteAddOnItems.map((food) => renderSavedAddOn(food, "favorite"))}
              </View>
            </View>
          ) : null}
          {recentAddOnItems.length ? (
            <View style={styles.addOnShortcutSection}>
              <Text style={[styles.sourceText, themed.muted]}>Recent add-ons</Text>
              <Text style={[styles.noteText, themed.muted]}>Choose a recent record, then enter the amount you used.</Text>
              <View style={styles.addOnShortcutRow}>
                {recentAddOnItems.map((food) => renderSavedAddOn(food, "recent"))}
              </View>
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Search provider-backed add-ons"
            accessibilityHint="Search sauces, toppings, or other foods that should contribute to meal macros."
            style={[styles.amountInput, themed.input]}
            value={addOnQuery}
            onChangeText={setAddOnQuery}
            placeholder="Search ranch, cheese, sugar, avocado..."
            placeholderTextColor={palette.muted}
            autoCapitalize="none"
            returnKeyType="search"
            blurOnSubmit
          />
          {addOnSearch.isLoading ? <Text style={[styles.sourceText, themed.muted]}>Searching add-ons...</Text> : null}
          {addOnQuery.trim().length >= 2 && !addOnSearch.isLoading && !addOnSearch.data?.items.length ? (
            <Text style={[styles.noteText, themed.warningText]}>No add-ons found yet. Try a simpler name.</Text>
          ) : null}
          {(addOnSearch.data?.items ?? []).slice(0, 3).map((food) => (
            <Pressable
              key={food.id}
              accessibilityRole="button"
              accessibilityLabel={`Add ${readableFoodName(food.displayName)} to this meal`}
              accessibilityHint={`${Math.round(food.nutrientsPer100g.caloriesKcal)} calories per 100 grams from ${food.provider.replaceAll("_", " ")}.`}
              style={[styles.addOnResult, themed.subsurface]}
              onPress={() => addFood(food)}
            >
              <View style={styles.itemCopy}>
                <Text numberOfLines={2} style={[styles.replacementTitle, themed.ink]}>
                  {readableFoodName(food.displayName)}
                </Text>
                <Text numberOfLines={1} style={[styles.sourceText, themed.muted]}>
                  {Math.round(food.nutrientsPer100g.caloriesKcal)} kcal per 100g - {food.dataType}
                </Text>
              </View>
              <Text style={[styles.addOnAddText, themed.actionText]}>Add</Text>
            </Pressable>
          ))}
          {addOns.length ? (
            <View style={styles.addOnList}>
          {addOns.map((addOn, index) => {
            const grams = parsePositiveNumber(addOn.grams);
            const nutrients = scalePer100gNutrients(addOn.food.nutrientsPer100g, grams);
            const hasQualityFlags = Boolean(addOn.food.qualityFlags?.length);
            const name = readableFoodName(addOn.food.displayName);
            return (
              <View key={addOn.id} style={[styles.addOnRow, themed.subsurface]}>
                <View style={styles.itemCopy}>
                  <Text numberOfLines={2} style={[styles.replacementTitle, themed.ink]}>
                    {name}
                  </Text>
                  <Text style={[styles.sourceText, themed.muted]}>
                    {grams > 0
                      ? `${Math.round(nutrients.caloriesKcal)} kcal · ${roundMacro(nutrients.proteinGrams)}g protein`
                      : "Enter grams greater than 0 before logging."}
                  </Text>
                  {hasQualityFlags ? (
                    <Text style={[styles.noteText, themed.warningText]}>
                      Source has quality warnings. Review it before relying on this add-on.
                    </Text>
                  ) : null}
                  <Link href={foodDetailHref(addOn.food.id, { contextLabel: "Camera add-on source" })} asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View nutrition source for ${name} add-on`}
                      style={[styles.inlineSourceButton, themed.subsurface]}
                    >
                      <Text style={[styles.sourceButtonText, themed.actionText]}>View add-on source</Text>
                    </Pressable>
                  </Link>
                </View>
                <View style={styles.addOnControls}>
                  <TextInput
                    style={[styles.addOnGramInput, themed.input]}
                    value={addOn.grams}
                    onChangeText={(value) => updateAddOn(addOn.id, { grams: value })}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`Grams for ${name} add-on`}
                    accessibilityHint="Enter the amount used in grams."
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${name} add-on up`}
                    accessibilityHint="Moves this add-on earlier in the saved meal order."
                    accessibilityState={{ disabled: index === 0 }}
                    disabled={index === 0}
                    style={[styles.addOnOrderButton, themed.subsurface, index === 0 ? styles.disabledAddOnOrderButton : undefined]}
                    onPress={() => moveAddOn(addOn.id, -1)}
                  >
                    <Ionicons name="chevron-up" size={18} color={palette.actionText} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${name} add-on down`}
                    accessibilityHint="Moves this add-on later in the saved meal order."
                    accessibilityState={{ disabled: index === addOns.length - 1 }}
                    disabled={index === addOns.length - 1}
                    style={[styles.addOnOrderButton, themed.subsurface, index === addOns.length - 1 ? styles.disabledAddOnOrderButton : undefined]}
                    onPress={() => moveAddOn(addOn.id, 1)}
                  >
                    <Ionicons name="chevron-down" size={18} color={palette.actionText} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name} add-on`}
                    style={[styles.clearReplacementButton, themed.subsurface]}
                    onPress={() => removeAddOn(addOn.id)}
                  >
                    <Text style={[styles.clearReplacementButtonText, themed.dangerText]}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
            </View>
          ) : null}
        </>
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
    notes: [
      meal.notes || meal.summary,
      meal.referencePlateDiameterMm
        ? `Optional plate reference: about ${formatPlateDiameter(meal.referencePlateDiameterMm)} across. Visual scale cue only; portions were confirmed separately.`
        : undefined,
    ]
      .filter(Boolean)
      .join(" "),
    items: items.flatMap((item) => {
      const review = itemReviews[item.id] ?? {};
      const confirmedGrams = parsePositiveNumber(review.grams) || item.servingGrams;
      const replacement = review.replacement;
      const addedOilGrams = parsePositiveNumber(review.addedOilGrams);
      const nutrients = adjustedNutrients(item, confirmedGrams, addedOilGrams, replacement);
      const baseNutrients = adjustedNutrients(item, confirmedGrams, 0, replacement);
      const nutrientsPer100g = nutrientsForPer100g(baseNutrients, confirmedGrams);
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
          analysisImageCount: meal.imageCount,
          referencePlateDiameterMm: meal.referencePlateDiameterMm,
          detectedName: item.detectedName,
          originalMatchedName: item.displayName,
          replacementFoodId: replacement ? `${replacement.provider}:${replacement.externalId}` : undefined,
          replacementDisplayName: replacement?.displayName,
          replacementNutrientsPer100g: replacement?.nutrientsPer100g,
          nutrientsPer100g,
          qualityAssessment: replacement?.qualityAssessment ?? item.qualityAssessment,
          originalEstimatedGrams: item.servingGrams,
          portionRangeGrams: item.portionRangeGrams,
          visiblePreparationCue: item.visiblePreparation,
          possibleHiddenIngredientCues: item.possibleHiddenIngredients,
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
            qualityAssessment: addOn.food.qualityAssessment,
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
            qualityAssessment: addOn.food.qualityAssessment,
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

  const blockedSource = items.find((item) => {
    const review = itemReviews[item.id];
    const selected = review?.replacement;
    return selected
      ? blocksFoodLogging(selected)
      : item.qualityAssessment?.isBlocking === true;
  });

  if (blockedSource) {
    const review = itemReviews[blockedSource.id];
    const assessment = review?.replacement?.qualityAssessment ?? blockedSource.qualityAssessment;
    return `Choose another nutrition record for ${readableFoodName(review?.replacement?.displayName ?? blockedSource.displayName)}. ${assessment?.summary ?? "Its essential per-100g nutrition data is incomplete or invalid."}`;
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

  const blockedAddOn = items.find((item) =>
    (itemReviews[item.id]?.addOns ?? []).some((addOn) => blocksFoodLogging(addOn.food))
  );

  if (blockedAddOn) {
    return `Choose another add-on nutrition record for ${readableFoodName(blockedAddOn.displayName)} before logging. An added food has incomplete or invalid per-100g data.`;
  }

  return undefined;
}

function isTerminalAnalysisJob(job: MealAnalysisJob | undefined) {
  return Boolean(job && ["needs_review", "failed", "cancelled", "expired"].includes(job.status));
}

function isFailedAnalysisJob(job: MealAnalysisJob) {
  return ["failed", "cancelled", "expired"].includes(job.status);
}

function analysisFailureCopy(job: MealAnalysisJob) {
  if (job.status === "cancelled") {
    return "This analysis was cancelled. Retake the photo or try a new scan when you are ready.";
  }
  if (job.status === "expired") {
    return "This analysis expired before it finished. Your meal was not logged; try the photo again.";
  }
  if (job.errorCode === "analysis_unavailable") {
    return "Meal analysis is temporarily unavailable. Your meal was not logged; try again shortly.";
  }
  if (job.errorCode === "invalid_analysis_input") {
    return "We could not safely use this photo. Retake it or import a different meal photo.";
  }
  return "This analysis did not finish. Your meal was not logged; try again when you are ready.";
}

function stableAnalysisKey(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
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

function MessageCard({
  title,
  body,
  tone,
  onRetry,
}: {
  title: string;
  body: string;
  tone: "review" | "ready";
  onRetry?: () => void;
}) {
  return (
    <InlineNotice
      title={title}
      body={body}
      tone={tone === "review" ? "warning" : "success"}
      actions={onRetry ? [{ label: "Try analysis again", onPress: onRetry, variant: "secondary" }] : undefined}
    />
  );
}

function roundMacro(value: number) {
  return Math.round(value * 10) / 10;
}

function parsePositiveNumber(value: string | undefined) {
  const parsed = Number((value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function cameraReviewCues(item: MealAnalysisItem) {
  const range = item.portionRangeGrams;
  const portion = range
    ? `Estimated visible portion: ${formatGramRange(range.minimum, range.maximum)}. Confirm the amount you ate below.`
    : `Estimated visible portion: about ${roundMacro(item.servingGrams)}g. Confirm the amount you ate below.`;
  const preparation =
    item.visiblePreparation && item.visiblePreparation !== "not_sure"
      ? `Visible preparation cue: ${item.visiblePreparation}. Confirm it below; a photo cannot verify every cooking detail.`
      : undefined;
  const hiddenIngredients = item.possibleHiddenIngredients.length
    ? `Possible details to review: ${item.possibleHiddenIngredients.join(", ")}. These are prompts, not confirmed ingredients.`
    : undefined;

  return { portion, preparation, hiddenIngredients };
}

function formatGramRange(minimum: number, maximum: number) {
  const roundedMinimum = roundMacro(minimum);
  const roundedMaximum = roundMacro(maximum);
  return roundedMinimum === roundedMaximum
    ? `about ${roundedMinimum}g`
    : `${roundedMinimum}-${roundedMaximum}g`;
}

function formatPlateDiameter(diameterMm: number) {
  return `${roundMacro(diameterMm / 10)} cm`;
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

function nutrientsForPer100g(nutrients: NutrientPer100g, grams: number): NutrientPer100g {
  if (grams <= 0) {
    return zeroNutrients();
  }

  const scale = 100 / grams;
  return {
    caloriesKcal: nutrients.caloriesKcal * scale,
    proteinGrams: nutrients.proteinGrams * scale,
    carbohydrateGrams: nutrients.carbohydrateGrams * scale,
    fatGrams: nutrients.fatGrams * scale,
    fiberGrams: nutrients.fiberGrams === undefined ? undefined : nutrients.fiberGrams * scale,
    sugarGrams: nutrients.sugarGrams === undefined ? undefined : nutrients.sugarGrams * scale,
    sodiumMilligrams: nutrients.sodiumMilligrams === undefined ? undefined : nutrients.sodiumMilligrams * scale,
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

export function confirmationThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    subsurface: { backgroundColor: palette.surfaceAlt },
    controlSurface: { backgroundColor: palette.controlSurface },
    input: { backgroundColor: palette.controlSurface, borderColor: palette.border, color: palette.ink },
    selectedPhoto: { backgroundColor: palette.cardAccent },
    stageDot: { backgroundColor: palette.cardInsight },
    savedMark: { backgroundColor: palette.mode === "dark" ? "#63B887" : colors.green },
    actionText: { color: palette.actionText },
    warningText: { color: palette.warningText },
    dangerText: { color: palette.dangerText },
    dangerSurface: { backgroundColor: palette.dangerSurface },
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
  content: {
    padding: spacing.xxl,
    paddingBottom: 180,
    gap: spacing.md,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  savedState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  savedMark: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  savedAction: {
    width: "100%",
    marginTop: spacing.sm,
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
  previewWrap: {
    position: "relative",
  },
  preview: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceAlt,
  },
  previewUnavailable: {
    minHeight: 180,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  previewUnavailableText: {
    ...typography.body,
    textAlign: "center",
  },
  previewCount: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    minHeight: 30,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    backgroundColor: "rgba(12, 27, 18, 0.74)",
  },
  previewCountText: {
    ...typography.caption,
    color: colors.white,
  },
  viewContext: {
    ...typography.caption,
    marginTop: -spacing.xs,
  },
  photoSelector: {
    gap: spacing.xs,
  },
  photoSelectorLabel: {
    ...typography.caption,
  },
  photoSelectorRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  photoSelectorItem: {
    flex: 1,
    overflow: "hidden",
    gap: spacing.xxs,
    borderWidth: 1.5,
    borderRadius: radii.sm,
    padding: spacing.xxs,
  },
  photoSelectorItemSelected: {
    backgroundColor: colors.limeSoft,
  },
  photoSelectorImage: {
    width: "100%",
    aspectRatio: 1.35,
    borderRadius: radii.xs,
    backgroundColor: colors.surfaceAlt,
  },
  photoSelectorCaption: {
    ...typography.caption,
    paddingHorizontal: spacing.xxs,
    paddingBottom: spacing.xxs,
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
    ...typography.displayLarge,
    color: colors.ink,
  },
  macroGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  analysisStages: { gap: spacing.sm, paddingTop: spacing.xs },
  analysisStage: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stageDot: { width: 9, height: 9, borderRadius: radii.pill },
  stageDotActive: { backgroundColor: colors.insight },
  stageText: { ...typography.caption, color: colors.muted },
  stageTextActive: { color: colors.insight },
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
  candidateRecordPanel: {
    gap: spacing.xs,
  },
  candidateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  candidateChip: {
    minHeight: 52,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  candidateChipText: {
    ...typography.button,
    color: colors.green,
  },
  candidateEvidenceText: {
    ...typography.caption,
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
    minHeight: 44,
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
  addOnHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  addOnSummary: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  addOnShortcutSection: {
    gap: spacing.xs,
  },
  addOnShortcutRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  addOnShortcut: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  addOnShortcutText: {
    ...typography.caption,
    fontWeight: "700",
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
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
  },
  addOnControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
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
  addOnOrderButton: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  disabledAddOnOrderButton: {
    opacity: 0.42,
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
  scanCuePanel: {
    gap: spacing.xs,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  preparationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  preparationChip: {
    minHeight: 44,
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
    minHeight: 44,
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
  },
  sourceText: {
    ...typography.caption,
    color: colors.muted,
  },
  photoPrivacyChoice: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  photoPrivacyChoiceDisabled: {
    opacity: 0.62,
  },
  photoPrivacyCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  photoPrivacyTitle: {
    ...typography.button,
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
    minHeight: 44,
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
    minHeight: 44,
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
