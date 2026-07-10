import { Ionicons } from "@expo/vector-icons";
import { Link, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing, typography } from "@living-nutrition/design-tokens";
import { floatingTabs, hiddenTabPaths, isFloatingTabActive } from "./floatingTabsConfig";

export function FloatingTabs() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      damping: 18,
      stiffness: 160,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [entrance, pathname]);

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
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.tabs}>
        {floatingTabs.map((tab) => {
          const active = isFloatingTabActive(tab, pathname);
          return (
            <Link key={tab.href} href={tab.href} asChild>
              <Pressable accessibilityRole="tab" style={[styles.tab, active ? styles.activeTab : undefined]}>
                <Ionicons
                  name={tab.icon as keyof typeof Ionicons.glyphMap}
                  size={22}
                  color={active ? colors.green : colors.muted}
                />
                <Text style={[styles.label, active ? styles.activeText : undefined]}>{tab.label}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  tabs: {
    width: "100%",
    maxWidth: 420,
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: radii.pill,
    padding: spacing.sm,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    shadowColor: colors.ink,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  tab: {
    flex: 1,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderRadius: radii.pill,
  },
  activeTab: {
    backgroundColor: colors.surfaceAlt,
  },
  label: {
    ...typography.caption,
    color: colors.muted,
  },
  activeText: {
    color: colors.green,
  },
});
