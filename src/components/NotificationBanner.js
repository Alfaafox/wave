import React, { useEffect, useRef } from 'react';
import { Animated, Text, Pressable, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, shadow } from '../theme';

const TOP = (Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 44) + spacing.sm;
const VISIBLE_MS = 4500;

// In-app banner shown for notifications that arrive while the app is
// foregrounded (the OS banner is suppressed in that case - see
// src/utils/notifications.js). Tap routes into the chat/call; it also
// auto-dismisses.
export default function NotificationBanner({ banner, onPress, onDismiss }) {
  const slide = useRef(new Animated.Value(-160)).current;
  const timer = useRef(null);

  useEffect(() => {
    if (!banner) return undefined;
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    timer.current = setTimeout(dismiss, VISIBLE_MS);
    return () => timer.current && clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner]);

  const dismiss = () => {
    Animated.timing(slide, { toValue: -160, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onDismiss && onDismiss();
    });
  };

  if (!banner) return null;

  const isCall = banner.data && (banner.data.type === 'call' || banner.data.type === 'missedCall');

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]}>
      <Pressable
        style={styles.card}
        onPress={() => {
          if (timer.current) clearTimeout(timer.current);
          onDismiss && onDismiss();
          onPress && onPress(banner.data || {});
        }}
      >
        <Ionicons
          name={isCall ? 'call' : 'chatbubble-ellipses'}
          size={20}
          color={colors.accent}
          style={styles.icon}
        />
        <Text style={styles.title} numberOfLines={1}>
          {banner.title || 'Wave'}
        </Text>
        <Text style={styles.body} numberOfLines={1}>
          {banner.body || ''}
        </Text>
        <Pressable hitSlop={10} onPress={dismiss} style={styles.close}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: TOP,
    left: spacing.md,
    right: spacing.md,
    zIndex: 9999,
    elevation: 9999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.md,
  },
  icon: { marginRight: spacing.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, maxWidth: '38%' },
  body: { fontSize: 14, color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 },
  close: { marginLeft: spacing.sm },
});
