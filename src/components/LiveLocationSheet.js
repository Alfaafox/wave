// src/components/LiveLocationSheet.js
//
// Bottom sheet for picking a live-location share duration (15 min / 1 hr /
// 8 hr), opened from LocationPickerScreen's "Share live location" row. Same
// manual Animated + PanResponder pattern as AudioOutputSheet.js /
// UserProfileModal.js - RN core Modal only, no gesture-handler, no new deps.
// Light theme (this sheet sits over LocationPickerScreen, not CallScreen).

import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity, StyleSheet,
  Animated, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 60;

export const LIVE_LOCATION_DURATIONS = [
  { durationMs: 15 * 60 * 1000, label: '15 minutes' },
  { durationMs: 60 * 60 * 1000, label: '1 hour' },
  { durationMs: 8 * 60 * 60 * 1000, label: '8 hours' },
];

export default function LiveLocationSheet({ visible, onPick, onClose }) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_HEIGHT);
      Animated.spring(translateY, {
        toValue: 0, useNativeDriver: true, friction: 9, tension: 70,
      }).start();
    }
  }, [visible, translateY]);

  const animateClose = () => {
    Animated.timing(translateY, {
      toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true,
    }).start(() => onCloseRef.current());
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 2,
      onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > DISMISS_THRESHOLD) {
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true,
          }).start(() => onCloseRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>
          <Text style={styles.title}>Share live location for...</Text>
          {LIVE_LOCATION_DURATIONS.map((d) => (
            <TouchableOpacity
              key={d.durationMs}
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => onPick(d.durationMs)}
            >
              <Ionicons name="time-outline" size={22} color={colors.accent} style={styles.rowIcon} />
              <Text style={styles.rowLabel}>{d.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancelRow} activeOpacity={0.7} onPress={animateClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: 40, paddingTop: 10, paddingBottom: 4,
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: {
    color: colors.textSecondary, fontSize: 14, fontWeight: '600',
    paddingHorizontal: spacing.xl, paddingTop: spacing.xs, paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  rowIcon: { marginRight: spacing.lg },
  rowLabel: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  cancelRow: {
    paddingVertical: spacing.lg, paddingHorizontal: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.divider, alignItems: 'center',
  },
  cancelText: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
});
