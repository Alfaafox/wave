import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Animated, Easing, Dimensions, Platform, StatusBar,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { markViewOnceViewed } from '../utils/api';
import ExpoCallAudioModule from '../../modules/expo-call-audio/src/ExpoCallAudioModule';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const TOP_INSET = (Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44) + 10;

const RING_SIZE = 76;
const RING_STROKE = 4;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_C = 2 * Math.PI * RING_R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// FLAG_SECURE / the iOS secure-layer trick. Fails soft: an older native build
// without setSecureScreen just won't block screenshots.
function setSecure(on) {
  try {
    ExpoCallAudioModule.setSecureScreen(on);
  } catch (e) {
    // no-op
  }
}

// Stripped-down full-screen viewer for a view-once photo or video. NOT
// ImageViewerModal: no zoom, no save, no share, and it marks the message
// viewed the moment it opens.
//
// Rendered as a plain absolutely-positioned View, NOT an RN <Modal> - same
// reasoning as CallScreen.js's fullScreenOverlay: on Android, Modal always
// renders inside a native Dialog window, and expo-video's VideoView (backed
// by a SurfaceView, same family as RTCView) is known to composite
// unreliably inside one. The caller (ChatScreen.js) already only mounts
// this component while a view-once message is open, so a plain View gives
// the same "cover everything" effect without the Dialog window.
export default function ViewOnceViewer({
  token, conversationId, messageId, uri, duration, messageType = 'image', onViewed, onClose,
}) {
  const isVideo = messageType === 'video';
  const timed = typeof duration === 'number' && duration > 0;
  const progress = useRef(new Animated.Value(0)).current;
  const [remaining, setRemaining] = useState(timed ? duration : 0);

  const closedRef = useRef(false);
  const tickRef = useRef(null);
  const animRef = useRef(null);
  // Always-fresh callbacks without re-running the mount effect.
  const cbRef = useRef({ onViewed, onClose });
  cbRef.current = { onViewed, onClose };

  // Source is null when not a video, so the player never loads the image
  // message's uri as media. Autoplays on open (setup callback).
  const player = useVideoPlayer(isVideo ? uri : null, (p) => {
    p.loop = false;
    p.play();
  });

  const finish = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (tickRef.current) clearInterval(tickRef.current);
    if (animRef.current) animRef.current.stop();
    if (isVideo) {
      try { player.pause(); } catch (e) { /* player already released */ }
    }
    setSecure(false);
    cbRef.current.onViewed && cbRef.current.onViewed();
    cbRef.current.onClose && cbRef.current.onClose();
  };

  useEffect(() => {
    setSecure(true);
    // Mark viewed on OPEN (WhatsApp behaviour). Fire and forget - the server
    // also broadcasts messageViewed to confirm.
    if (token && conversationId && messageId) {
      markViewOnceViewed(token, conversationId, messageId).catch(() => {});
    }

    if (timed) {
      animRef.current = Animated.timing(progress, {
        toValue: 1,
        duration: duration * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      animRef.current.start(({ finished }) => {
        if (finished) finish();
      });
      tickRef.current = setInterval(() => {
        setRemaining((r) => Math.max(0, r - 1));
      }, 1000);
    }

    // Untimed ("open") video: close the moment it finishes playing, since
    // there's no ring countdown to do it. Untimed images have no natural
    // end - the close button (X) is the only way out for those.
    let sub;
    if (!timed && isVideo) {
      sub = player.addListener('playToEnd', finish);
    }

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (animRef.current) animRef.current.stop();
      if (sub) sub.remove();
      setSecure(false); // safety net
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, RING_C],
  });

  return (
    <View style={styles.fullScreenOverlay}>
      <View style={styles.container}>
        <Text style={styles.blockedLabel}>Screenshot blocked</Text>

        {isVideo ? (
          <VideoView
            player={player}
            style={styles.image}
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
          />
        ) : (
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        )}

        {timed ? (
          <View style={styles.ringWrap} pointerEvents="none">
            <View style={{ transform: [{ rotate: '-90deg' }] }}>
              <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_R}
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={RING_STROKE}
                  fill="none"
                />
                <AnimatedCircle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_R}
                  stroke="#fff"
                  strokeWidth={RING_STROKE}
                  fill="none"
                  strokeDasharray={RING_C}
                  strokeDashoffset={dashoffset}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
            <Text style={styles.ringText}>{remaining}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={finish}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          >
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreenOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 9999, elevation: 9999,
  },
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_W, height: SCREEN_H },
  blockedLabel: {
    position: 'absolute', top: TOP_INSET, alignSelf: 'center',
    color: 'rgba(255,255,255,0.55)', fontSize: 12, letterSpacing: 0.3,
  },
  closeBtn: { position: 'absolute', top: TOP_INSET - 4, right: 12, padding: 8 },
  ringWrap: {
    position: 'absolute', bottom: 60, alignSelf: 'center',
    width: RING_SIZE, height: RING_SIZE, alignItems: 'center', justifyContent: 'center',
  },
  ringText: { position: 'absolute', color: '#fff', fontSize: 22, fontWeight: '700' },
});
