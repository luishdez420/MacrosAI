import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { FoodDetail, FoodServingOption, NutrientPer100g } from "@living-nutrition/shared-types";
import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { Card, InlineNotice, SourceBadge, StatusPill } from "../../shared/components/LivingUI";
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

  return (
    <Card>
      <View style={styles.panelHeader}>
        <View style={styles.panelCopy}>
          <Text style={styles.cardEyebrow}>Source</Text>
          <Text style={styles.cardTitle}>{providerDisplayName(food.provider)}</Text>
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

      <Text style={styles.body}>{food.provenanceSummary}</Text>
      <Text style={styles.body}>{confidence.description}</Text>

      <SourceReferenceLink sourceReference={food.sourceReference} />
    </Card>
  );
}

export function QualityFlagList({ flags }: { flags: string[] }) {
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
      <Text style={styles.cardEyebrow}>Quality warnings</Text>
      <Text style={styles.body}>
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
              <Text style={styles.body}>{display.description}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function ServingBasisCard({ servingOptions }: { servingOptions: FoodServingOption[] }) {
  return (
    <Card>
      <Text style={styles.cardEyebrow}>Serving basis</Text>
      <Text style={styles.cardTitle}>Calculated from per-100g data</Text>
      <Text style={styles.body}>
        Logging uses nutrient per 100 grams multiplied by the portion entered. Serving choices are
        only precise when the source gives a verified gram weight.
      </Text>

      <View style={styles.servingList}>
        {servingOptions.map((option) => {
          const description = servingOptionDescription(option);
          return (
            <View key={`${option.label}-${option.quantity}-${option.unit}`} style={styles.servingRow}>
              <View style={styles.servingCopy}>
                <Text style={styles.rowLabel}>{option.label}</Text>
                <Text style={styles.body}>{description.amount}</Text>
              </View>
              <Text style={styles.servingDetail}>{description.detail}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function NutrientTable({ nutrients }: { nutrients: NutrientPer100g }) {
  return (
    <Card>
      <Text style={styles.cardEyebrow}>Nutrition per 100g</Text>
      <Text style={styles.body}>
        These normalized values are the calculation basis. The app rounds for display only.
      </Text>
      <View style={styles.nutrientTable}>
        {formatNutrientRows(nutrients).map((row) => (
          <View key={row.label} style={styles.nutrientRow} accessible accessibilityLabel={row.accessibilityLabel}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <Text style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function OriginalNutrientIdsPanel({ originalNutrientIds }: { originalNutrientIds: Record<string, string> }) {
  const entries = Object.entries(originalNutrientIds);

  if (!entries.length) {
    return null;
  }

  return (
    <Card>
      <Text style={styles.cardEyebrow}>Original nutrient IDs</Text>
      <Text style={styles.body}>
        Provider nutrient identifiers are preserved so calculations can be audited later.
      </Text>
      <View style={styles.nutrientTable}>
        {entries.map(([key, value]) => (
          <View key={key} style={styles.nutrientRow}>
            <Text style={styles.rowLabel}>{key}</Text>
            <Text style={styles.rowValue}>{value}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function SourceReferenceLink({ sourceReference }: { sourceReference: string }) {
  const canOpen = sourceReference.startsWith("http://") || sourceReference.startsWith("https://");

  function openReference() {
    if (!canOpen) {
      return;
    }

    void Linking.openURL(sourceReference).catch(() => undefined);
  }

  return (
    <View style={styles.sourceReference}>
      <Text style={styles.rowLabel}>Source reference</Text>
      <Text selectable style={styles.sourceReferenceText}>
        {sourceReference}
      </Text>
      {canOpen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open nutrition source reference"
          style={styles.referenceButton}
          onPress={openReference}
        >
          <Text style={styles.referenceButtonText}>Open source</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
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
