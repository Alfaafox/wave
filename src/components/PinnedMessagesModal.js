// src/components/PinnedMessagesModal.js
//
// Bottom sheet listing every pinned message in a conversation (shown when
// there are 2-3 pins; a single pin is handled inline by ChatScreen's pin bar).
// Same manual Modal + Animated + PanResponder drag-to-dismiss pattern as
// UserProfileModal / ImageViewerModal.
//
// Tap a row -> jump to that message in the chat. Long-press a row -> Unpin.
// The parent closes this modal automatically once fewer than 2 pins remain.

import React, { useMemo, useRef } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, Pressable,
  StyleSheet, Animated, PanResponder, Alert, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 60;

function snippet(pin) {
  if (pin.message_type === 'image') return 'Photo';
  if (pin.message_type === 'audio') return 'Voice message';
  if (pin.message_type === 'location') return 'Location';
  return (pin.content || '').replace(/\s+/g, ' ').trim() || 'Message';
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function PinnedMessagesModal({ visible, onClose, pins, onJumpTo, onUnpin }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_THRESHOLD) {
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true })
              .start(() => onCloseRef.current());
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          }
        },
      }),
    [translateY]
  );

  if (!visible) return null;

  const list = Array.isArray(pins) ? pins : [];

  const handleRowLongPress = (pin) => {
    Alert.alert('Unpin message?', 'This removes it from the pinned messages for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unpin', style: 'destructive', onPress: () => onUnpin?.(pin) },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>

          <View style={styles.titleRow}>
            <Ionicons name="pin" size={16} color={colors.accent} style={{ marginRight: spacing.sm }} />
            <Text style={styles.title}>Pinned Messages</Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} bounces={false}>
            {list.map((pin) => (
              <TouchableOpacity
                key={String(pin.id ?? pin.message_id)}
                style={styles.row}
                activeOpacity={0.6}
                onPress={() => { onClose?.(); onJumpTo?.(pin.message_id); }}
                onLongPress={() => handleRowLongPress(pin)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowSender} numberOfLines={1}>{pin.sender_name || 'Unknown'}</Text>
                  <Text style={styles.rowSnippet} numberOfLines={2}>{snippet(pin)}</Text>
                </View>
                <Text style={styles.rowDate}>{fmtDate(pin.pinned_at)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
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
    maxHeight: '70%',
    paddingBottom: spacing.xl,
  },
  handleArea: {
    alignItems: 'center', justifyContent: 'center', minHeight: 44,
    paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },
  handle: { width: 40, height: 5, borderRadius: radii.pill, backgroundColor: colors.border },

  titleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingBottom: spacing.sm,
  },
  title: { ...typography.headerTitle, fontSize: 17, color: colors.textPrimary },

  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  rowSender: { fontSize: 13, fontWeight: '700', color: colors.accent },
  rowSnippet: { fontSize: 14, color: colors.textPrimary, marginTop: 2 },
  rowDate: { fontSize: 11, color: colors.textMuted, marginLeft: spacing.md },
});
