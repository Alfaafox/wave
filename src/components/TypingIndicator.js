// src/components/TypingIndicator.js
//
// Three-state typing indicator rendered at the bottom of the message list,
// styled like a received message bubble.
//
//   'typing' -> three dots doing a staggered bounce wave (each dot's 400ms
//               cycle starts 150ms after the previous one)
//   'paused' -> a single dot doing a slow 2s breathing pulse (opacity 1 -> 0.4 -> 1)
//   'gone'   -> renders nothing
//
// React Native's own Animated API only (same one CallScreen / ImageViewerModal
// use). translateY / opacity all run on the native driver; a short opacity
// fade on the content wrapper smooths the typing<->paused swap.

import React, { useEffect, useRef } from 'react';
import { View, Text, Image, Animated, Easing, StyleSheet } from 'react-native';
import { colors, spacing, radii } from '../theme';

const DOT_TRAVEL = -6;
const DOT_HALF = 200; // ms up, ms down -> 400ms cycle
const DOT_STAGGER = 150;
const BREATHE_HALF = 1000; // ms -> 2000ms cycle

function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

export default function TypingIndicator({ state = 'gone', isGroup = false, name, avatarUri }) {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  const breathe = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Drive the active animation for the current state.
  useEffect(() => {
    if (state === 'typing') {
      const loops = [];
      const timers = [];
      dots.forEach((v, i) => {
        v.setValue(0);
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(v, { toValue: DOT_TRAVEL, duration: DOT_HALF, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: DOT_HALF, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          ])
        );
        loops.push(loop);
        // Stagger only the START; each loop then runs at a clean 400ms period
        // so the 150ms phase offset between dots stays fixed (no drift).
        timers.push(setTimeout(() => loop.start(), i * DOT_STAGGER));
      });
      return () => {
        timers.forEach(clearTimeout);
        loops.forEach((l) => l.stop());
      };
    }

    if (state === 'paused') {
      breathe.setValue(1);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 0.4, duration: BREATHE_HALF, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 1, duration: BREATHE_HALF, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }

    return undefined;
  }, [state, dots, breathe]);

  // Smooth the swap between 'typing' and 'paused'.
  useEffect(() => {
    if (state === 'gone') return;
    fade.setValue(0.35);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [state, fade]);

  if (state === 'gone') return null;

  return (
    <View style={styles.row}>
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarFallbackText}>{initial(name)}</Text>
        </View>
      )}

      <View style={styles.bubbleColumn}>
        {isGroup && !!name && <Text style={styles.groupName} numberOfLines={1}>{name}</Text>}
        <View style={styles.bubble}>
          <Animated.View style={[styles.dotsRow, { opacity: fade }]}>
            {state === 'typing' ? (
              dots.map((v, i) => (
                <Animated.View
                  key={i}
                  style={[styles.dot, i > 0 && styles.dotGap, { transform: [{ translateY: v }] }]}
                />
              ))
            ) : (
              <Animated.View style={[styles.dot, { opacity: breathe }]} />
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const AVATAR = 28;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    maxWidth: '78%',
    paddingBottom: spacing.sm,
  },
  avatarImage: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, marginRight: spacing.sm },
  avatarFallback: {
    width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, marginRight: spacing.sm,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  avatarFallbackText: { color: colors.textOnAccent, fontSize: 12, fontWeight: '700' },

  bubbleColumn: { flexShrink: 1 },
  groupName: { fontSize: 12, fontWeight: '700', color: colors.accent, marginBottom: 2, marginLeft: spacing.xs },
  bubble: {
    backgroundColor: colors.bubbleIncoming,
    borderRadius: radii.bubble,
    borderBottomLeftRadius: radii.bubbleTail,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    alignSelf: 'flex-start',
  },
  dotsRow: { flexDirection: 'row', alignItems: 'center', height: 8 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.textSecondary },
  dotGap: { marginLeft: 5 },
});
