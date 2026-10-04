import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import type { RunStatusPresentation } from "../shared/runState";

interface RunStatusBadgeProps {
  color: string;
  status: RunStatusPresentation;
  textColor: string;
}

export function RunStatusBadge({ color, status, textColor }: RunStatusBadgeProps) {
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    if (status.motion !== "pulse") {
      setReduceMotion(true);
      return;
    }

    let active = true;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      subscription.remove();
    };
  }, [status.motion]);

  useEffect(() => {
    if (status.motion !== "pulse" || reduceMotion) {
      pulseOpacity.stopAnimation();
      pulseOpacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          duration: 700,
          toValue: 0.3,
          useNativeDriver: false,
        }),
        Animated.timing(pulseOpacity, {
          duration: 700,
          toValue: 1,
          useNativeDriver: false,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulseOpacity, reduceMotion, status.motion]);

  return (
    <View
      accessible
      accessibilityLabel={status.label}
      accessibilityRole="text"
      style={[styles.badge, { backgroundColor: color }]}
    >
      {status.motion === "pulse" ? (
        <Animated.View
          style={[styles.dot, { backgroundColor: textColor, opacity: pulseOpacity }]}
        />
      ) : null}
      <Text style={[styles.text, { color: textColor }]}>{status.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: 10,
    fontWeight: "800",
  },
});
