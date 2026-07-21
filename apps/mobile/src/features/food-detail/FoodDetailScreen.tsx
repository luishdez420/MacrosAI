import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { FoodDetail } from "@living-nutrition/shared-types";
import { colors, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { api } from "../../services/api";
import {
  ActionButton,
  Card,
  InlineNotice,
  readableFoodName,
  ScreenShell,
  SourceBadge,
  StatusPill,
} from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import {
  NutrientTable,
  OriginalNutrientIdsPanel,
  ProvenancePanel,
  QualityAssessmentPanel,
  QualityFlagList,
  ServingBasisCard,
  SourceConflictPanel,
  SourceHistoryPanel,
} from "./FoodDetailPanels";
import {
  confidenceDisplay,
  providerDisplayName,
  snapshotFoodDetailFromMealItem,
} from "./foodDetailPresentation";

const correctionTypes = [
  { label: "Wrong macros", value: "wrong_nutrients" },
  { label: "Serving issue", value: "wrong_serving" },
  { label: "Wrong match", value: "wrong_food_match" },
  { label: "Other", value: "other" },
] as const;

type CorrectionType = (typeof correctionTypes)[number]["value"];

export function FoodDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { palette } = useTheme();
  const themed = foodDetailThemeStyles(palette);
  const [favoriteNotice, setFavoriteNotice] = useState<string | null>(null);
  const [correctionType, setCorrectionType] = useState<CorrectionType>("wrong_nutrients");
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [correctionNotice, setCorrectionNotice] = useState<{
    title: string;
    body: string;
    tone: "success" | "warning" | "danger";
  } | null>(null);
  const params = useLocalSearchParams<{
    id?: string;
    mealId?: string;
    itemId?: string;
    contextLabel?: string;
  }>();
  const foodId = stringParam(params.id);
  const mealId = stringParam(params.mealId);
  const itemId = stringParam(params.itemId);
  const contextLabel = stringParam(params.contextLabel);
  const food = useQuery({
    queryKey: ["food-detail", foodId],
    queryFn: () => api.getFood(foodId || ""),
    enabled: Boolean(foodId),
    retry: 1,
  });
  const meal = useQuery({
    queryKey: ["meal", mealId, "food-detail-fallback"],
    queryFn: () => api.getMeal(mealId || ""),
    enabled: Boolean(mealId && itemId),
    retry: 1,
  });
  const snapshotItem = meal.data?.items.find((item) => item.id === itemId);
  const snapshotDetail = snapshotItem ? snapshotFoodDetailFromMealItem(snapshotItem) : undefined;
  const detail = food.data ?? (food.isError ? snapshotDetail : undefined);
  const favorites = useQuery({
    queryKey: ["foods", "favorites"],
    queryFn: () => api.getFavoriteFoods(),
    enabled: Boolean(foodId),
  });
  const showingSnapshot = Boolean(food.isError && snapshotDetail && !food.data);
  const fallbackExpected = Boolean(mealId && itemId);
  const fallbackLoading = fallbackExpected && meal.isLoading;
  const isFavorite = Boolean(detail && favorites.data?.items.some((item) => item.id === detail.id));
  const favoriteMutation = useMutation({
    mutationFn: async () => {
      if (!detail) {
        return;
      }

      if (isFavorite) {
        await api.removeFavoriteFood(detail.id);
      } else {
        await api.addFavoriteFood(detail.id);
      }
    },
    onSuccess: async () => {
      setFavoriteNotice(null);
      await queryClient.invalidateQueries({ queryKey: ["foods", "favorites"] });
    },
    onError: (error) => {
      setFavoriteNotice(error.message);
    },
  });
  const correctionMutation = useMutation({
    mutationFn: () => {
      if (!detail) {
        throw new Error("Food source is not available yet.");
      }

      return api.createFoodCorrectionReport(detail.id, {
        reportType: correctionType,
        message: correctionMessage.trim(),
      });
    },
    onSuccess: () => {
      setCorrectionMessage("");
      setCorrectionNotice({
        title: "Correction report sent",
        body: "Thank you. This source remains an estimate until reviewed, and your report helps flag it.",
        tone: "success",
      });
    },
    onError: (error) => {
      setCorrectionNotice({
        title: "Correction report was not sent",
        body: error.message,
        tone: "danger",
      });
    },
  });

  function submitCorrectionReport() {
    if (showingSnapshot) {
      setCorrectionNotice({
        title: "Live source required",
        body: "Retry the live source lookup before reporting this record so the correction can be tied to the provider source.",
        tone: "warning",
      });
      return;
    }

    if (correctionMessage.trim().length < 8) {
      setCorrectionNotice({
        title: "Add a little more detail",
        body: "Describe what looks wrong, such as the calories, serving size, product match, or source label.",
        tone: "warning",
      });
      return;
    }

    correctionMutation.mutate();
  }

  if (!foodId) {
    return (
      <ScreenShell>
        <InlineNotice
          title="Food source unavailable"
          body="This screen needs a food identifier before it can load provenance details."
          tone="warning"
          actions={[{ label: "Go back", onPress: router.back, variant: "secondary" }]}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, themed.muted]}>Nutrition source</Text>
          <Text style={[styles.title, themed.ink]}>{detail ? readableFoodName(detail.displayName) : "Loading source"}</Text>
          <Text style={[styles.body, themed.muted]}>
            Inspect the source record, serving basis, and quality checks before logging or editing.
          </Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => router.back()}>
          <Text style={[styles.textButtonLabel, themed.actionText]}>Close</Text>
        </Pressable>
      </View>

      {contextLabel ? (
        <SourceBadge label={contextLabel} tone="neutral" style={styles.contextBadge} />
      ) : null}

      {favoriteNotice ? (
        <InlineNotice title="Favorite was not updated" body={favoriteNotice} tone="warning" />
      ) : null}

      {food.isLoading ? <LoadingSourceCard /> : null}

      {food.isError && fallbackLoading ? (
        <LoadingSnapshotCard />
      ) : null}

      {food.isError && !snapshotDetail && !fallbackLoading ? (
        <InlineNotice
          title="Source could not load"
          body={meal.error ? `${food.error.message} Snapshot fallback also failed: ${meal.error.message}` : food.error.message}
          tone="danger"
          actions={[
            { label: "Retry", onPress: () => void food.refetch(), variant: "primary" },
            { label: "Go back", onPress: router.back, variant: "secondary" },
          ]}
        />
      ) : null}

      {showingSnapshot ? (
        <InlineNotice
          title="Showing saved snapshot"
          body="The live source lookup failed, so this screen is showing the nutrition provenance saved with the meal item."
          tone="warning"
          actions={[{ label: "Retry live source", onPress: () => void food.refetch(), variant: "secondary" }]}
        />
      ) : null}

      {detail ? (
        <>
          <ActionButton
            label={
              favoriteMutation.isPending
                ? "Updating favorite..."
                : isFavorite
                  ? "Remove from favorites"
                  : "Add to favorites"
            }
            variant={isFavorite ? "secondary" : "primary"}
            onPress={() => favoriteMutation.mutate()}
            disabled={favoriteMutation.isPending}
          />
          <CorrectionReportCard
            selectedType={correctionType}
            message={correctionMessage}
            notice={correctionNotice}
            isPending={correctionMutation.isPending}
            sourceUnavailable={showingSnapshot}
            onSelectType={setCorrectionType}
            onChangeMessage={setCorrectionMessage}
            onSubmit={submitCorrectionReport}
          />
          <OverviewCard food={detail} />
          <ProvenancePanel food={detail} />
          <SourceHistoryPanel history={detail.retrievalHistory ?? []} />
          <SourceConflictPanel conflicts={detail.sourceConflicts} />
          <QualityAssessmentPanel assessment={detail.qualityAssessment} />
          <QualityFlagList flags={detail.qualityFlags ?? []} />
          <ServingBasisCard servingOptions={detail.servingOptions} />
          <NutrientTable nutrients={detail.nutrientsPer100g} />
          <OriginalNutrientIdsPanel originalNutrientIds={detail.originalNutrientIds ?? {}} />
        </>
      ) : null}
    </ScreenShell>
  );
}

function OverviewCard({ food }: { food: FoodDetail }) {
  const confidence = confidenceDisplay(food.recordConfidence);
  const hasWarnings = Boolean(food.qualityFlags?.length) || food.qualityAssessment?.status === "needs_review";
  const { palette } = useTheme();
  const themed = foodDetailThemeStyles(palette);

  return (
    <Card tone={hasWarnings || food.recordConfidence === "low" ? "soft" : "surface"}>
      <View style={styles.overviewTop}>
        <View style={styles.headerCopy}>
          <Text style={[styles.cardEyebrow, themed.muted]}>Food record</Text>
          <Text style={[styles.cardTitle, themed.ink]}>{readableFoodName(food.displayName)}</Text>
        </View>
        <StatusPill label={confidence.label} tone={confidence.tone === "danger" ? "danger" : confidence.tone} />
      </View>
      <View style={styles.badgeRow}>
        <SourceBadge label={providerDisplayName(food.provider)} tone="success" />
        <SourceBadge label={food.dataType} tone={hasWarnings ? "warning" : "neutral"} />
      </View>
      <Text style={[styles.body, themed.muted]}>
        {food.qualityAssessment?.isBlocking
          ? "This record cannot be logged because essential per-100g data is incomplete or invalid. Choose another record."
          : hasWarnings || food.recordConfidence === "low"
            ? "Needs review before logging. Use the provider data as a starting point, not a guarantee."
            : "Ready for portion-based logging after you confirm the amount eaten."}
      </Text>
    </Card>
  );
}

function CorrectionReportCard({
  selectedType,
  message,
  notice,
  isPending,
  sourceUnavailable,
  onSelectType,
  onChangeMessage,
  onSubmit,
}: {
  selectedType: CorrectionType;
  message: string;
  notice: { title: string; body: string; tone: "success" | "warning" | "danger" } | null;
  isPending: boolean;
  sourceUnavailable: boolean;
  onSelectType: (value: CorrectionType) => void;
  onChangeMessage: (value: string) => void;
  onSubmit: () => void;
}) {
  const { palette } = useTheme();
  const themed = foodDetailThemeStyles(palette);
  return (
    <Card tone="soft">
      <Text style={[styles.cardEyebrow, themed.muted]}>Correction report</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Something look wrong?</Text>
      <Text style={[styles.body, themed.muted]}>
        Report source-data issues without changing your saved meals. This helps flag records that
        may need review before future logging.
      </Text>

      {notice ? <InlineNotice title={notice.title} body={notice.body} tone={notice.tone} /> : null}

      {sourceUnavailable ? (
        <InlineNotice
          title="Live source unavailable"
          body="Reports need a live or stored provider source. Retry the live source lookup before submitting."
          tone="warning"
        />
      ) : null}

      <View style={styles.correctionTypeGrid}>
        {correctionTypes.map((type) => {
          const active = selectedType === type.value;
          return (
            <Pressable
              key={type.value}
              accessibilityRole="button"
              style={[styles.correctionTypeButton, themed.subsurface, active ? styles.activeCorrectionType : undefined]}
              onPress={() => onSelectType(type.value)}
            >
              <Text
                style={[
                  styles.correctionTypeText,
                  { color: active ? palette.onPrimary : palette.ink },
                ]}
              >
                {type.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        style={[styles.correctionInput, themed.input]}
        value={message}
        onChangeText={onChangeMessage}
        placeholder="Example: calories look too high for 100g, or this barcode matched the wrong flavor."
        placeholderTextColor={palette.muted}
        multiline
        textAlignVertical="top"
      />
      <ActionButton
        label={isPending ? "Sending report..." : "Send correction report"}
        variant="secondary"
        onPress={onSubmit}
        disabled={isPending}
      />
    </Card>
  );
}

function LoadingSourceCard() {
  const { palette } = useTheme();
  const themed = foodDetailThemeStyles(palette);
  return (
    <Card>
      <Text style={[styles.cardEyebrow, themed.muted]}>Loading</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Checking nutrition source...</Text>
      <Text style={[styles.body, themed.muted]}>
        Fetching provider metadata, serving options, quality flags, and per-100g values.
      </Text>
    </Card>
  );
}

function LoadingSnapshotCard() {
  const { palette } = useTheme();
  const themed = foodDetailThemeStyles(palette);
  return (
    <Card>
      <Text style={[styles.cardEyebrow, themed.muted]}>Fallback</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Checking saved meal snapshot...</Text>
      <Text style={[styles.body, themed.muted]}>
        The live source lookup failed. Looking for the nutrition source snapshot saved with this meal.
      </Text>
    </Card>
  );
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function foodDetailThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    actionText: { color: palette.actionText },
    subsurface: { backgroundColor: palette.surfaceAlt },
    input: {
      backgroundColor: palette.controlSurface,
      borderColor: palette.border,
      color: palette.ink,
    },
  };
}

const styles = StyleSheet.create({
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
  contextBadge: {
    alignSelf: "flex-start",
  },
  overviewTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardEyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  correctionTypeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  correctionTypeButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  activeCorrectionType: {
    backgroundColor: colors.green,
  },
  correctionTypeText: {
    ...typography.button,
    color: colors.ink,
  },
  activeCorrectionTypeText: {
    color: colors.white,
  },
  correctionInput: {
    minHeight: 104,
    borderRadius: 18,
    padding: spacing.md,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
});
