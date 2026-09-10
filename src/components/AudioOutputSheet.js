// src/components/AudioOutputSheet.js
//
// Bottom sheet for picking the call audio output when more than two routes are
// available (i.e. a Bluetooth headset is connected). Same manual Animated +
// PanResponder pattern as UserProfileModal.js / ImageViewerModal.js - RN core
// Modal only, no gesture-handler, no new deps. Styled for the CallScreen dark
// theme (dark background, white text). Slides up on open (spring), slides down
// on close / drag-dismiss (timing).
import React, { useEffect, useRef } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity, StyleSheet,
  Animated, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 60;

// Fixed display order; only routes present in `routes` are rendered.
const ROUTE_ROWS = [
  { route: 'bluetooth', icon: 'bluetooth', label: 'Bluetooth' },
  { route: 'earpiece', icon: 'ear-outline', label: 'Earpiece' },
  { route: 'speaker', icon: 'volume-high-outline', label: 'Speaker' },
];

export default function AudioOutputSheet({ visible, routes, activeRoute, onSelect, onClose }) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  // onClose captured in a ref so the once-built PanResponder always sees the latest.
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

  const rows = ROUTE_ROWS.filter((r) => (routes || []).includes(r.route));

  return (
    <Modal visible transparent animationType="none" onRequestClose={animateClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>
          <Text style={styles.title}>Audio Output</Text>
          {rows.map((r) => {
            const active = r.route === activeRoute;
            return (
              <TouchableOpacity
                key={r.route}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => onSelect(r.route)}
              >
                <Ionicons
                  name={r.icon}
                  size={22}
                  color={r.route === 'bluetooth' ? '#4DA3FF' : '#fff'}
                  style={styles.rowIcon}
                />
                <Text style={styles.rowLabel}>{r.label}</Text>
                {active && <Ionicons name="checkmark" size={22} color="#25D366" />}
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1C1E24',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 34,
  },
  handleArea: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: 40, paddingTop: 10, paddingBottom: 4,
  },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  title: {
    color: '#fff', fontSize: 15, fontWeight: '700',
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20 },
  rowIcon: { marginRight: 16 },
  rowLabel: { flex: 1, color: '#fff', fontSize: 16 },
});
