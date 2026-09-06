import React, { useState, useRef } from 'react';
import { Modal, View, Image, TouchableOpacity, ActivityIndicator, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;

export default function ImageViewerModal({ visible, uri, onClose, onSave, saving }) {
  const [imageLoading, setImageLoading] = useState(true);
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 10 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          translateY.setValue(gesture.dy);
          const fade = 1 - Math.min(gesture.dy / (SCREEN_HEIGHT * 0.6), 0.7);
          opacity.setValue(fade);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > DISMISS_THRESHOLD) {
          Animated.parallel([
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 200, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          ]).start(() => {
            translateY.setValue(0);
            opacity.setValue(1);
            onClose();
          });
        } else {
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
            Animated.spring(opacity, { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Animated.View
          style={[styles.imageWrap, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          {imageLoading && (
            <ActivityIndicator size="large" color="#fff" style={styles.loadingSpinner} />
          )}
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onLoadEnd={() => setImageLoading(false)}
          />
        </Animated.View>

        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.saveButton} onPress={onSave} disabled={saving} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="download-outline" size={24} color="#fff" />
          )}
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  imageWrap: { width: '100%', height: '80%', justifyContent: 'center', alignItems: 'center' },
  image: { width: '100%', height: '100%' },
  loadingSpinner: { position: 'absolute' },
  closeButton: { position: 'absolute', top: 50, left: spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  saveButton: { position: 'absolute', top: 50, right: spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
});
