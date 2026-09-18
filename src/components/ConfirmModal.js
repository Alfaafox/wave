// src/components/ConfirmModal.js
//
// Shared confirmation/warning/destructive-action modal, replacing Alert.alert()
// across the app. RN core only (Modal, Animated, TouchableOpacity, View, Text,
// Pressable) - no external libraries, matching the project's existing
// hand-rolled Modal + Animated + PanResponder convention (UserProfileModal,
// ImageViewerModal, AudioOutputSheet).
import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated, Pressable } from 'react-native';
import { colors, radii } from '../theme';

const VARIANT_COLORS = {
  destructive: '#E53935',
  warning: '#F57C00',
  confirm: colors.accent || '#2C6BED',
  info: colors.accent || '#2C6BED',
};

export default function ConfirmModal({
  visible,
  variant = 'confirm',
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    if (visible) {
      scale.setValue(0.92);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
    }
  }, [visible]);

  const confirmColor = VARIANT_COLORS[variant] || VARIANT_COLORS.confirm;
  const showCancel = variant !== 'info';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Animated.View style={[styles.card, { transform: [{ scale }] }]} onStartShouldSetResponder={() => true}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!body && <Text style={styles.body}>{body}</Text>}

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.confirmBtn, { backgroundColor: confirmColor }]}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
            {showCancel && (
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface || '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    maxWidth: 320,
    width: '80%',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text || colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttons: {
    gap: 8,
  },
  confirmBtn: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelBtn: {
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border || '#E0E0E0',
  },
  cancelText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
});
