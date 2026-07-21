import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { colors, typography } from "@living-nutrition/design-tokens";
import { useTheme } from "../theme/ThemeProvider";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type MacroRingProps = {
  value: number;
  target: number;
  size: number;
  strokeWidth: number;
};

export function MacroRing({ value, target, size, strokeWidth }: MacroRingProps) {
  const { palette } = useTheme();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const targetProgress = target > 0 ? Math.min(Math.max(value / target, 0), 1) : 0;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;

    // Jest does not drive SVG animated props inside React's act() boundary.
    // Render the finished value there while real devices still receive motion.
    if (process.env.NODE_ENV === "test") {
      progress.setValue(targetProgress);
      return undefined;
    }

    AccessibilityInfo.isReduceMotionEnabled().then((reducedMotion) => {
      if (!active) return;
      if (reducedMotion) {
        progress.setValue(targetProgress);
        return;
      }
      animation = Animated.timing(progress, { toValue: targetProgress, duration: 520, useNativeDriver: false });
      animation.start();
    });

    return () => {
      active = false;
      animation?.stop();
    };
  }, [progress, targetProgress]);

  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  return (
    <View accessibilityLabel={`${Math.round(value)} calories logged out of ${Math.round(target)} daily target`} style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="macroRingGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.green} />
            <Stop offset="0.52" stopColor={colors.lime} />
            <Stop offset="1" stopColor={colors.carbs} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={palette.progressTrack} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#macroRingGradient)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.label}>
          <Text style={[styles.value, { color: palette.ink }]}>{Math.round(value)}</Text>
          <Text style={[styles.caption, { color: palette.muted }]}>kcal logged</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
  label: { flex: 1, alignItems: "center", justifyContent: "center" },
  value: { ...typography.stat, fontVariant: ["tabular-nums"] },
  caption: { ...typography.caption, textAlign: "center" },
});
