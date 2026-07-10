import Svg, { Circle } from "react-native-svg";
import { Text, View, StyleSheet } from "react-native";

import { colors, typography } from "@living-nutrition/design-tokens";

type MacroRingProps = {
  value: number;
  target: number;
  size: number;
  strokeWidth: number;
};

export function MacroRing({ value, target, size, strokeWidth }: MacroRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / target, 1);
  const offset = circumference * (1 - progress);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.surfaceAlt}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.lime}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFillObject}>
        <View style={styles.label}>
          <Text style={styles.value}>{Math.round(value)}</Text>
          <Text style={styles.caption}>kcal logged</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    ...typography.stat,
    color: colors.ink,
  },
  caption: {
    ...typography.caption,
    color: colors.muted,
  },
});
