import React, { useState, useRef, useEffect } from 'react';
import { Modal, View, Image, TouchableOpacity, ActivityIndicator, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_AREA_HEIGHT = SCREEN_HEIGHT * 0.8; // imageWrap is height: '80%'
const DISMISS_THRESHOLD = 120;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;
const TAP_SLOP = 10;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const touchDistance = (touches) => {
  const [a, b] = touches;
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
};

export default function ImageViewerModal({ visible, uri, onClose, onSave, saving }) {
  const [imageLoading, setImageLoading] = useState(true);

  // Dismiss (swipe-down) transform - only active at 1x.
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  // Zoom / pan transform - applied to the image itself.
  const scale = useRef(new Animated.Value(1)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;

  // Synchronous mirrors of the Animated values (PanResponder runs on JS and
  // needs to read the current scale/offset every frame). Kept in step both by
  // the gesture handlers (which write them directly) and by listeners (which
  // catch changes driven by Animated.spring on release / double-tap).
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef({ mode: 'none', startDist: 0, startScale: 1, startPan: { x: 0, y: 0 } });
  const lastTapRef = useRef(0);

  useEffect(() => {
    const s = scale.addListener(({ value }) => { scaleRef.current = value; });
    const x = panX.addListener(({ value }) => { panRef.current.x = value; });
    const y = panY.addListener(({ value }) => { panRef.current.y = value; });
    return () => {
      scale.removeListener(s);
      panX.removeListener(x);
      panY.removeListener(y);
    };
  }, [scale, panX, panY]);

  // Reset every transform whenever a new image is shown (or the modal reopens).
  const resetTransforms = () => {
    scale.setValue(1);
    panX.setValue(0);
    panY.setValue(0);
    translateY.setValue(0);
    opacity.setValue(1);
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    gestureRef.current.mode = 'none';
  };
  useEffect(() => {
    resetTransforms();
    setImageLoading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, visible]);

  const maxPanX = () => Math.max(0, (scaleRef.current - 1) * SCREEN_WIDTH * 0.5);
  const maxPanY = () => Math.max(0, (scaleRef.current - 1) * IMAGE_AREA_HEIGHT * 0.5);

  const springTo = (targetScale, targetX, targetY) => {
    scaleRef.current = targetScale;
    panRef.current = { x: targetX, y: targetY };
    Animated.parallel([
      Animated.spring(scale, { toValue: targetScale, useNativeDriver: true, friction: 7, tension: 60 }),
      Animated.spring(panX, { toValue: targetX, useNativeDriver: true, friction: 7, tension: 60 }),
      Animated.spring(panY, { toValue: targetY, useNativeDriver: true, friction: 7, tension: 60 }),
    ]).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      // Claim the touch on start so double-taps register. The close / save
      // buttons sit outside this view (higher in the tree), so they still get
      // their own taps; keep this gesture uninterruptible once it has begun.
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onMoveShouldSetPanResponder: (evt, g) => {
        if (evt.nativeEvent.touches.length === 2) return true;       // pinch
        if (scaleRef.current > 1.01) return true;                    // pan while zoomed
        // not zoomed: keep the original swipe-down-to-dismiss
        return g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx);
      },

      onPanResponderGrant: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          gestureRef.current = {
            mode: 'pinch',
            startDist: touchDistance(touches),
            startScale: scaleRef.current,
            startPan: { ...panRef.current },
          };
        } else {
          gestureRef.current = {
            mode: scaleRef.current > 1.01 ? 'pan' : 'dismiss',
            startDist: 0,
            startScale: scaleRef.current,
            startPan: { ...panRef.current },
          };
        }
      },

      onPanResponderMove: (evt, g) => {
        const touches = evt.nativeEvent.touches;

        if (touches.length === 2) {
          if (gestureRef.current.mode !== 'pinch') {
            gestureRef.current = {
              mode: 'pinch',
              startDist: touchDistance(touches),
              startScale: scaleRef.current,
              startPan: { ...panRef.current },
            };
            return;
          }
          const ratio = touchDistance(touches) / (gestureRef.current.startDist || 1);
          // allow a little travel past the limits so the release spring reads
          const next = clamp(gestureRef.current.startScale * ratio, 0.7, MAX_SCALE + 0.4);
          scaleRef.current = next;
          scale.setValue(next);
          return;
        }

        if (gestureRef.current.mode === 'pinch') return; // finger lifted mid-pinch

        if (gestureRef.current.mode === 'pan') {
          const nx = clamp(gestureRef.current.startPan.x + g.dx, -maxPanX(), maxPanX());
          const ny = clamp(gestureRef.current.startPan.y + g.dy, -maxPanY(), maxPanY());
          panRef.current = { x: nx, y: ny };
          panX.setValue(nx);
          panY.setValue(ny);
          return;
        }

        // dismiss drag (only reached at 1x)
        if (g.dy > 0) {
          translateY.setValue(g.dy);
          opacity.setValue(1 - Math.min(g.dy / (SCREEN_HEIGHT * 0.6), 0.7));
        }
      },

      onPanResponderRelease: (evt, g) => {
        const mode = gestureRef.current.mode;
        gestureRef.current.mode = 'none';
        const now = Date.now();
        const wasTap = Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP;

        // Double-tap -> reset to 1x.
        if (wasTap) {
          if (now - lastTapRef.current < DOUBLE_TAP_MS) {
            lastTapRef.current = 0;
            springTo(1, 0, 0);
            Animated.parallel([
              Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
              Animated.spring(opacity, { toValue: 1, useNativeDriver: true }),
            ]).start();
            return;
          }
          lastTapRef.current = now;
        }

        if (mode === 'pinch') {
          if (scaleRef.current < MIN_SCALE) {
            springTo(MIN_SCALE, 0, 0); // spring-back when released below 1x
          } else if (scaleRef.current > MAX_SCALE) {
            springTo(MAX_SCALE, clamp(panRef.current.x, -maxPanX(), maxPanX()), clamp(panRef.current.y, -maxPanY(), maxPanY()));
          } else {
            springTo(
              scaleRef.current,
              clamp(panRef.current.x, -maxPanX(), maxPanX()),
              clamp(panRef.current.y, -maxPanY(), maxPanY()),
            );
          }
          return;
        }

        if (mode === 'pan') {
          springTo(
            scaleRef.current,
            clamp(panRef.current.x, -maxPanX(), maxPanX()),
            clamp(panRef.current.y, -maxPanY(), maxPanY()),
          );
          return;
        }

        // dismiss drag
        if (g.dy > DISMISS_THRESHOLD && scaleRef.current <= 1.01) {
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

      // Safety settle if the gesture is ever cut off mid-flight.
      onPanResponderTerminate: () => {
        gestureRef.current.mode = 'none';
        if (scaleRef.current < MIN_SCALE) {
          springTo(MIN_SCALE, 0, 0);
        } else {
          springTo(
            clamp(scaleRef.current, MIN_SCALE, MAX_SCALE),
            clamp(panRef.current.x, -maxPanX(), maxPanX()),
            clamp(panRef.current.y, -maxPanY(), maxPanY()),
          );
        }
        Animated.parallel([
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
          Animated.spring(opacity, { toValue: 1, useNativeDriver: true }),
        ]).start();
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
          <Animated.Image
            source={{ uri }}
            style={[styles.image, { transform: [{ translateX: panX }, { translateY: panY }, { scale }] }]}
            resizeMode="contain"
            onLoadEnd={() => setImageLoading(false)}
          />
        </Animated.View>

        <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>

        {onSave && (
          <TouchableOpacity style={styles.saveButton} onPress={onSave} disabled={saving} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="download-outline" size={24} color="#fff" />
            )}
          </TouchableOpacity>
        )}
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
