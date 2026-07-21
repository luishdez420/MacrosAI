import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type {
  FoodDetail,
  FoodQualityAssessment,
  FoodServingOption,
  FoodSourceConflict,
  FoodSourceRevision,
  NutrientPer100g,
} from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography, type ThemePalette } from "@living-nutrition/design-tokens";
import { Card, InlineNotice, SourceBadge, StatusPill } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { foodQualityDisplay, foodQualitySignals } from "../../shared/domain/foodQuality";
import {
  confidenceDisplay,
  formatDate,
  formatNutrientRows,
  providerDisplayName,
  qualityFlagDisplay,
  servingOptionDescription,
} from "./foodDetailPresentation";

export function ProvenancePanel({ food }: { food: FoodDetail }) {
  const confidence = confidenceDisplay(food.recordConfidence);
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  return (
    <Card>
      <View style={styles.panelHeader}>
        <View style={styles.panelCopy}>
          <Text style={[styles.cardEyebrow, themed.muted]}>Source</Text>
          <Text style={[styles.cardTitle, themed.ink]}>{providerDisplayName(food.provider)}</Text>
        </View>
        <StatusPill label={confidence.label} tone={confidence.tone === "danger" ? "danger" : confidence.tone} />
      </View>

      <View style={styles.badgeRow}>
        <SourceBadge label={food.dataType || "Source record"} tone="neutral" />
        {food.brandOwner ? <SourceBadge label={food.brandOwner} tone="success" /> : null}
      </View>

      <InfoRow label="External ID" value={food.externalId} />
      <InfoRow label="Published" value={formatDate(food.publicationDate)} />
      <InfoRow label="Retrieved" value={formatDate(food.retrievedAt)} />

      <Text style={[styles.body, themed.muted]}>{food.provenanceSummary}</Text>
      <Text style={[styles.body, themed.muted]}>{confidence.description}</Text>

      <SourceReferenceLink sourceReference={food.sourceReference} />
    </Card>
  );
}

export function QualityFlagList({ flags }: { flags: string[] }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  if (!flags.length) {
    return (
      <InlineNotice
        title="No quality warnings found"
        body="This does not make the record perfect, but the basic provider checks did not flag obvious issues."
        tone="success"
      />
    );
  }

  return (
    <Card tone="soft">
      <Text style={[styles.cardEyebrow, themed.muted]}>Quality warnings</Text>
      <Text style={[styles.body, themed.muted]}>
        Review these before logging. Warnings are shown in text, not only by color.
      </Text>
      <View style={styles.flagList}>
        {flags.map((flag) => {
          const display = qualityFlagDisplay(flag);
          return (
            <View key={flag} style={styles.flagRow}>
              <StatusPill
                label={display.label}
                tone={display.tone === "danger" ? "danger" : "warning"}
                style={styles.flagPill}
              />
              <Text style={[styles.body, themed.muted]}>{display.description}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function QualityAssessmentPanel({ assessment }: { assessment?: FoodQualityAssessment }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);
  const display = foodQualityDisplay(assessment);

  return (
    <Card tone={assessment?.isBlocking ? "soft" : "surface"}>
      <View style={styles.panelHeader}>
        <View style={styles.panelCopy}>
          <Text style={[styles.cardEyebrow, themed.muted]}>Record quality</Text>
          <Text style={[styles.cardTitle, themed.ink]}>{display.label}</Text>
        </View>
        <StatusPill label={assessment?.isBlocking ? "Do not log" : display.label} tone={display.tone} />
      </View>
      <Text style={[styles.body, themed.muted]}>{assessment?.summary ?? display.description}</Text>
      <Text style={[styles.servingDetail, themed.muted]}>
        Signals: {foodQualitySignals(assessment)}
      </Text>
    </Card>
  );
}

export function ServingBasisCard({ servingOptions }: { servingOptions: FoodServingOption[] }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  return (
    <Card>
      <Text style={[styles.cardEyebrow, themed.muted]}>Serving basis</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Calculated from per-100g data</Text>
      <Text style={[styles.body, themed.muted]}>
        Logging uses nutrient per 100 grams multiplied by the portion entered. Serving choices are
        only precise when the source gives a verified gram weight.
      </Text>

      <View style={styles.servingList}>
        {servingOptions.map((option) => {
          const description = servingOptionDescription(option);
          return (
            <View key={`${option.label}-${option.quantity}-${option.unit}`} style={[styles.servingRow, themed.subsurface]}>
              <View style={styles.servingCopy}>
                <Text style={[styles.rowLabel, themed.muted]}>{option.label}</Text>
                <Text style={[styles.body, themed.ink]}>{description.amount}</Text>
              </View>
              <Text style={[styles.servingDetail, themed.muted]}>{description.detail}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function NutrientTable({ nutrients }: { nutrients: NutrientPer100g }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  return (
    <Card>
      <Text style={[styles.cardEyebrow, themed.muted]}>Nutrition per 100g</Text>
      <Text style={[styles.body, themed.muted]}>
        These normalized values are the calculation basis. The app rounds for display only.
      </Text>
      <View style={[styles.nutrientTable, themed.tableBorder]}>
        {formatNutrientRows(nutrients).map((row) => (
          <View key={row.label} style={[styles.nutrientRow, themed.tableRow]} accessible accessibilityLabel={row.accessibilityLabel}>
            <Text style={[styles.rowLabel, themed.muted]}>{row.label}</Text>
            <Text style={[styles.rowValue, themed.ink]}>{row.value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function SourceHistoryPanel({ history }: { history: FoodSourceRevision[] }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  if (!history.length) {
    return null;
  }

  return (
    <Card tone="soft">
      <Text style={[styles.cardEyebrow, themed.muted]}>Source history</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Provider record changes</Text>
      <Text style={[styles.body, themed.muted]}>
        This retains the most recent source-data changes. It never changes nutrition already saved
        with a meal.
      </Text>
      <View style={styles.historyList}>
        {history.map((revision, index) => (
          <View
            key={`${revision.sourceRetrievedAt}-${revision.sourceReference}`}
            style={[styles.historyRow, themed.subsurface]}
            accessible
            accessibilityLabel={sourceHistoryAccessibilityLabel(revision, index === 0)}
          >
            <View style={styles.historyTopRow}>
              <Text style={[styles.rowLabel, themed.muted]}>
                {index === 0 ? "Latest source snapshot" : "Previous source snapshot"}
              </Text>
              <Text style={[styles.rowValue, themed.ink]}>{formatDate(revision.sourceRetrievedAt)}</Text>
            </View>
            <Text style={[styles.historyNutrition, themed.ink]}>
              {Math.round(revision.nutrientsPer100g.caloriesKcal)} kcal - {formatQuantity(revision.nutrientsPer100g.proteinGrams)} protein - {formatQuantity(revision.nutrientsPer100g.carbohydrateGrams)} carbs - {formatQuantity(revision.nutrientsPer100g.fatGrams)} fat per 100g
            </Text>
            {revision.qualityFlags?.length ? (
              <Text style={[styles.servingDetail, themed.muted]}>
                {revision.qualityFlags.length} quality warning{revision.qualityFlags.length === 1 ? "" : "s"} recorded
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

export function SourceConflictPanel({ conflicts }: { conflicts?: FoodSourceConflict[] }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  if (!conflicts?.length) {
    return null;
  }

  return (
    <Card tone="soft">
      <Text style={[styles.cardEyebrow, themed.muted]}>Provider comparison history</Text>
      <Text style={[styles.cardTitle, themed.ink]}>Similar records disagreed</Text>
      <Text style={[styles.body, themed.muted]}>
        This is retained source-data evidence, not a change to meals you already saved. Review the
        provider reference before logging when the disagreement is still current.
      </Text>
      <View style={styles.historyList}>
        {conflicts.map((conflict) => (
          <View
            key={`${conflict.conflictingProvider}-${conflict.conflictingExternalId}-${conflict.lastDetectedAt}`}
            style={[styles.historyRow, themed.subsurface]}
            accessible
            accessibilityLabel={`${conflict.isCurrentConflict ? "Current" : "Historical"} nutrition conflict with ${providerDisplayName(
              conflict.conflictingProvider
            )} record ${conflict.conflictingDisplayName}, last detected ${formatDate(conflict.lastDetectedAt)}.`}
          >
            <View style={styles.historyTopRow}>
              <Text style={[styles.rowLabel, themed.muted]}>
                {providerDisplayName(conflict.conflictingProvider)}
              </Text>
              <StatusPill
                label={conflict.isCurrentConflict ? "Needs review" : "Historical"}
                tone={conflict.isCurrentConflict ? "warning" : "neutral"}
              />
            </View>
            <Text style={[styles.historyNutrition, themed.ink]}>{conflict.conflictingDisplayName}</Text>
            <Text style={[styles.servingDetail, themed.muted]}>
              First detected {formatDate(conflict.firstDetectedAt)}. Last detected {formatDate(conflict.lastDetectedAt)}.
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function OriginalNutrientIdsPanel({ originalNutrientIds }: { originalNutrientIds: Record<string, string> }) {
  const entries = Object.entries(originalNutrientIds);
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  if (!entries.length) {
    return null;
  }

  return (
    <Card>
      <Text style={[styles.cardEyebrow, themed.muted]}>Original nutrient IDs</Text>
      <Text style={[styles.body, themed.muted]}>
        Provider nutrient identifiers are preserved so calculations can be audited later.
      </Text>
      <View style={[styles.nutrientTable, themed.tableBorder]}>
        {entries.map(([key, value]) => (
          <View key={key} style={[styles.nutrientRow, themed.tableRow]}>
            <Text style={[styles.rowLabel, themed.muted]}>{key}</Text>
            <Text style={[styles.rowValue, themed.ink]}>{value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function SourceReferenceLink({ sourceReference }: { sourceReference: string }) {
  const canOpen = sourceReference.startsWith("http://") || sourceReference.startsWith("https://");
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  function openReference() {
    if (!canOpen) {
      return;
    }

    void Linking.openURL(sourceReference).catch(() => undefined);
  }

  return (
    <View style={[styles.sourceReference, themed.divider]}>
      <Text style={[styles.rowLabel, themed.muted]}>Source reference</Text>
      <Text selectable style={[styles.sourceReferenceText, themed.ink]}>
        {sourceReference}
      </Text>
      {canOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open nutrition source reference"
          style={[styles.referenceButton, themed.subsurface]}
          onPress={openReference}
        >
          <Text style={[styles.referenceButtonText, { color: palette.actionText }]}>Open source</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { palette } = useTheme();
  const themed = foodDetailPanelThemeStyles(palette);

  return (
    <View style={[styles.infoRow, themed.divider]}>
      <Text style={[styles.rowLabel, themed.muted]}>{label}</Text>
      <Text style={[styles.rowValue, themed.ink]}>{value}</Text>
    </View>
  );
}

function formatQuantity(value: number) {
  return `${Math.round(value * 10) / 10}g`;
}

function sourceHistoryAccessibilityLabel(revision: FoodSourceRevision, isLatest: boolean) {
  return `${isLatest ? "Latest" : "Previous"} provider source snapshot from ${formatDate(
    revision.sourceRetrievedAt
  )}: ${Math.round(revision.nutrientsPer100g.caloriesKcal)} kilocalories, ${formatQuantity(
    revision.nutrientsPer100g.proteinGrams
  )} protein, ${formatQuantity(revision.nutrientsPer100g.carbohydrateGrams)} carbohydrates, and ${formatQuantity(
    revision.nutrientsPer100g.fatGrams
  )} fat per 100 grams.`;
}

function foodDetailPanelThemeStyles(palette: ThemePalette) {
  return {
    ink: { color: palette.ink },
    muted: { color: palette.muted },
    subsurface: { backgroundColor: palette.surfaceAlt },
    divider: { borderTopColor: palette.border },
    tableBorder: { borderColor: palette.border },
    tableRow: { backgroundColor: palette.controlSurface, borderBottomColor: palette.border },
  };
}

const styles = StyleSheet.create({
  panelHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  panelCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  cardEyebrow: {
    ...typography.eyebrow,
    color: colors.muted,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.ink,
  },
  body: {
    ...typography.body,
    color: colors.muted,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
    paddingTop: spacing.sm,
  },
  rowLabel: {
    ...typography.caption,
    color: colors.muted,
  },
  rowValue: {
    ...typography.caption,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },
  sourceReference: {
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
    paddingTop: spacing.sm,
  },
  sourceReferenceText: {
    ...typography.caption,
    color: colors.ink,
  },
  referenceButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  referenceButtonText: {
    ...typography.button,
    color: colors.green,
  },
  flagList: {
    gap: spacing.sm,
  },
  flagRow: {
    gap: spacing.xs,
  },
  flagPill: {
    alignSelf: "flex-start",
  },
  historyList: {
    gap: spacing.sm,
  },
  historyRow: {
    gap: spacing.xs,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  historyTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  historyNutrition: {
    ...typography.caption,
  },
  servingList: {
    gap: spacing.sm,
  },
  servingRow: {
    gap: spacing.xs,
    borderRadius: radii.md,
    padding: spacing.md,
    backgroundColor: colors.background,
  },
  servingCopy: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  servingDetail: {
    ...typography.caption,
    color: colors.muted,
  },
  nutrientTable: {
    borderRadius: radii.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.surfaceAlt,
  },
  nutrientRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceAlt,
    backgroundColor: colors.background,
  },
});
