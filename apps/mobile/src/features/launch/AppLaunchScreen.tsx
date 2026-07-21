import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radii, spacing, typography } from "@living-nutrition/design-tokens";
import { GlassSurface, SkeletonBlock } from "../../shared/components/LivingUI";
import { useTheme } from "../../shared/theme/ThemeProvider";

export function AppLaunchScreen() {
  const { palette } = useTheme();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[palette.backgroundWarm, palette.background, palette.backgroundDeep]}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[styles.orb, styles.orbTop, { backgroundColor: palette.orbPrimary }]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom, { backgroundColor: palette.orbSecondary }]} />

      <View accessibilityRole="progressbar" accessibilityLabel="Preparing Living Nutrition" style={styles.content}>
        <View style={[styles.mark, { backgroundColor: palette.controlSurface, borderColor: palette.border }]}>
          <Ionicons name="leaf-outline" size={34} color={palette.actionText} />
        </View>
        <Text style={[styles.brand, { color: palette.actionText }]}>LIVING NUTRITION</Text>
        <Text style={[styles.title, { color: palette.ink }]}>Your diary is getting ready.</Text>
        <Text style={[styles.body, { color: palette.muted }]}>Preparing your saved nutrition view.</Text>

        <GlassSurface level="content" style={styles.preview} contentStyle={styles.previewContent}>
          <View style={styles.previewHeading}>
            <SkeletonBlock width="38%" height={13} />
            <SkeletonBlock width="22%" height={13} />
          </View>
          <SkeletonBlock height={32} width="46%" />
          <View style={styles.previewTiles}>
            <SkeletonBlock height={58} width="31%" />
            <SkeletonBlock height={58} width="31%" />
            <SkeletonBlock height={58} width="31%" />
          </View>
        </GlassSurface>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  orb: { position: "absolute", borderRadius: radii.pill, opacity: 0.6 },
  orbTop: { width: 280, height: 280, top: -126, right: -118 },
  orbBottom: { width: 240, height: 240, bottom: -138, left: -108 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xxl, gap: spacing.md },
  mark: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
  },
  brand: { ...typography.eyebrow, letterSpacing: 1.7 },
  title: { ...typography.displayLarge, maxWidth: 300 },
  body: { ...typography.body, maxWidth: 300 },
  preview: { marginTop: spacing.lg, borderRadius: radii.lg },
  previewContent: { gap: spacing.md, padding: spacing.lg },
  previewHeading: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  previewTiles: { flexDirection: "row", gap: spacing.sm },
});
