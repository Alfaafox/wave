// src/components/FavouriteStar.js
//
// Animated favourites star. Parent owns the `filled` state (so the value can
// be lifted / persisted); this component only renders it and plays the tap
// animation:
//   - the star scales 1.0 -> 1.4 -> 1.0 (spring back)
//   - its colour interpolates between grey (colors.textMuted) and gold
//   - a short burst of small gold dots flies outward and fades
//
// Uses React Native's own Animated API (the same one CallScreen.js and
// ImageViewerModal.js use) - no reanimated, no native deps. The colour
// interpolation runs on the JS driver (useNativeDriver: false); the scale
// and the particles run on the native driver. They are separate Animated
// values on separate views, so the drivers never collide.

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

const GOLD = '#FFD700'; // explicit per spec - not a theme token
const PARTICLE_COUNT = 8;
const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

export default function FavouriteStar({ filled, onToggle, size = 26, disabled = false, style }) {
  const scale = useRef(new Animated.Value(1)).current;
  const colorT = useRef(new Animated.Value(filled ? 1 : 0)).current;
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => new Animated.Value(0))
  ).current;

  // Keep the resting colour in sync if `filled` changes from the outside
  // (e.g. loaded from storage) without a tap.
  useEffect(() => {
    Animated.timing(colorT, {
      toValue: filled ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [filled, colorT]);

  const handlePress = () => {
    if (disabled) return;
    const next = !filled;
    onToggle?.(next);

    scale.stopAnimation();
    scale.setValue(1);
    Animated.sequence([
      Animated.timing(scale, {
        toValue: 1.4,
        duration: 130,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 3,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();

    // Particle burst plays on every tap (spec: "on tap").
    particles.forEach((p) => p.setValue(0));
    Animated.stagger(
      14,
      particles.map((p) =>
        Animated.timing(p, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      )
    ).start();
  };

  const animatedColor = colorT.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.textMuted, GOLD],
  });

  return (
    <Pressable onPress={handlePress} hitSlop={12} disabled={disabled} style={style}>
      <View style={styles.wrap}>
        {particles.map((p, i) => {
          const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
          const dist = size * 0.9;
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                styles.particle,
                {
                  opacity: p.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 0] }),
                  transform: [
                    { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * dist] }) },
                    { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * dist] }) },
                    { scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
                  ],
                },
              ]}
            />
          );
        })}
        <Animated.View style={{ transform: [{ scale }] }}>
          <AnimatedIonicons
            name={filled ? 'star' : 'star-outline'}
            size={size}
            style={{ color: animatedColor }}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  particle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 5,
    height: 5,
    marginTop: -2.5,
    marginLeft: -2.5,
    borderRadius: 2.5,
    backgroundColor: GOLD,
  },
});
