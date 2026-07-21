import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Link, usePathname } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, elevations, motion, radii, spacing } from "@living-nutrition/design-tokens";
import { GlassSurface } from "./LivingUI";
import { floatingTabs, hiddenTabPaths, isFloatingTabActive } from "./floatingTabsConfig";
import { useTheme } from "../theme/ThemeProvider";
import { useScrollNavigation } from "./ScrollNavigationContext";

export function FloatingTabs() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { compact } = useScrollNavigation();
  const entrance = useRef(new Animated.Value(0)).current;
  const compactProgress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      ...motion.spring,
      useNativeDriver: true,
    }).start();
  }, [entrance, pathname]);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      compactProgress.setValue(compact ? 1 : 0);
      return;
    }

    Animated.timing(compactProgress, {
      toValue: compact ? 1 : 0,
      duration: motion.control,
      useNativeDriver: true,
    }).start();
  }, [compact, compactProgress, reduceMotion]);

  if (hiddenTabPaths.has(pathname)) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { bottom: Math.max(insets.bottom, spacing.sm) + spacing.sm },
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }),
            },
          ],
        },
      ]}
    >
      <Animated.View
        style={{
          transform: [
            {
              scale: compactProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.93] }),
            },
          ],
        }}
      >
        <GlassSurface level="navigation" style={styles.tabs} contentStyle={styles.tabsContent}>
          {floatingTabs.map((tab) => {
          const active = isFloatingTabActive(tab, pathname);
          const isScan = tab.href === "/camera";

          return (
            <Link key={tab.href} href={tab.href} asChild>
              <Pressable
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  if (isScan) {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                  } else {
                    void Haptics.selectionAsync().catch(() => undefined);
                  }
                }}
                style={({ pressed }) => [
                  isScan ? styles.scanTab : styles.tab,
                  active && !isScan ? [styles.activeTab, { backgroundColor: palette.surfaceAlt, borderColor: colors.green }] : undefined,
                  active && isScan ? styles.activeScanTab : undefined,
                  pressed ? styles.pressed : undefined,
                ]}
              >
                <View style={isScan ? styles.scanIconWrap : styles.tabIconWrap}>
                  <Ionicons
                    name={tab.icon as keyof typeof Ionicons.glyphMap}
                    size={isScan ? 24 : 22}
                    color={isScan ? palette.onPrimary : active ? colors.green : palette.muted}
                  />
                </View>
              </Pressable>
            </Link>
          );
          })}
        </GlassSurface>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.xxs, right: spacing.xxs, alignItems: "center" },
  tabs: { width: "100%", maxWidth: 640, minHeight: 68, borderRadius: radii.pill, paddingHorizontal: spacing.xs, paddingVertical: 6, ...elevations.navigation },
  tabsContent: { flexDirection: "row", alignItems: "center" },
  tab: { flex: 1, minWidth: 0, minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  activeTab: {},
  scanTab: { flex: 1, minWidth: 0, minHeight: 60, alignItems: "center", justifyContent: "center", marginTop: -spacing.lg },
  tabIconWrap: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: radii.pill },
  scanIconWrap: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.green, borderWidth: 4, borderColor: "rgba(248, 252, 244, 0.95)", ...elevations.floating },
  activeScanTab: { opacity: 1 },
  pressed: { transform: [{ scale: 0.95 }], opacity: 0.86 },
});
