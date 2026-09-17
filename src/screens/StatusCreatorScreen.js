// src/screens/StatusCreatorScreen.js
//
// Updates / Status composer, Instagram-Stories-style: full-bleed photo/video/
// text canvas, floating chrome, draggable/pinchable/rotatable/deletable
// stickers. No in-app camera capture - Photo mode's gallery picker is the
// only way to get a photo/video in (see MODES below).
// No new dependencies - PanResponder + Animated (RN core) only, following
// this exact codebase's own CropOverlay pattern in ChatScreen.js (snapshot
// position on grant into a ref, compute every move from that fixed
// snapshot, commit to real state only on release). No
// react-native-gesture-handler (not installed) and no expo-linear-gradient
// (not installed - the 8 text-mode backgrounds are solid colors).
//
// Backend note (Session 20): status_updates only has fixed columns -
// content, caption, bg_color, location (JSON), show_time (bool), poll_data
// (JSON) - see routes/status.js. It has no concept of an arbitrary,
// positioned sticker list. This screen was rewritten to let you compose
// with several stickers of any type, but on Post: the FIRST location
// sticker maps to `location`, any time sticker sets `show_time`, the FIRST
// complete poll sticker maps to `poll_data` - all as before. Free-floating
// TEXT stickers have no backend field at all; rather than silently
// discarding what someone typed, their content is appended into `caption`
// (the one field the viewer actually renders as on-image text) instead of
// disappearing. This is a real, documented limitation of composing richer
// than the backend persists - fixing it properly means a schema change,
// out of scope for a client-only screen rewrite.
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, Alert, Animated, Platform, StatusBar, PanResponder,
  KeyboardAvoidingView, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { VideoView, useVideoPlayer } from 'expo-video';
import { createStatus } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 54;

const TEXT_MAX_LEN = 500;
const MAX_IMAGE_KB = 3000;
const MAX_VIDEO_KB = 6000;
const NOMINATIM_USER_AGENT = 'WaveChatApp/1.0 (contact: gurudayal90@gmail.com)';
const TRASH_THRESHOLD_Y = 0.82;

// 8 solid preset backgrounds for text statuses - a WhatsApp/Instagram-style
// vivid palette, distinct from theme.js's own chrome tokens.
const BG_COLORS = [
  '#1B2A4A', '#2C6BED', '#E53E3E', '#F5A623',
  '#8E44AD', '#1F9D55', '#D6336C', '#0EA5A5',
];

const MODES = [
  { key: 'photo', label: 'Photo' },
  { key: 'video', label: 'Video' },
  { key: 'text', label: 'Text' },
];

const STICKER_MENU_ITEMS = [
  { type: 'location', icon: 'location', title: 'Location', subtitle: 'Add your location' },
  { type: 'time', icon: 'time-outline', title: 'Time & Date', subtitle: 'Current time and date' },
  { type: 'poll', icon: 'bar-chart-outline', title: 'Poll', subtitle: 'Ask your contacts' },
  { type: 'text', icon: 'text-outline', title: 'Text', subtitle: 'Add a text overlay' },
];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function approxKb(dataUri) {
  return Math.round((dataUri.length * 0.75) / 1024);
}

function textFontSize(len) {
  if (len < 80) return 28;
  if (len < 150) return 22;
  return 16;
}

function touchDistance(t0, t1) {
  const dx = t0.pageX - t1.pageX;
  const dy = t0.pageY - t1.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchAngle(t0, t1) {
  const dx = t1.pageX - t0.pageX;
  const dy = t1.pageY - t0.pageY;
  return Math.atan2(dy, dx);
}

function formatTimeDate(date) {
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${time} - ${day}`;
}

let stickerSeq = 0;
function nextStickerId() {
  stickerSeq += 1;
  return `sticker_${Date.now()}_${stickerSeq}`;
}

// ---------------------------------------------------------------------
// DraggableSticker: owns one PanResponder handling BOTH single-finger drag
// (move) and two-finger pinch (resize), exactly the combined-responder
// pattern the task describes. onMoveShouldSetPanResponder only claims the
// gesture past a small movement threshold (or the instant a 2nd finger
// lands) so a plain tap always falls through untouched to whatever the
// sticker itself renders (a TextInput, a tap-to-edit Text) - the same
// "claim on move, not on start" trick ChatScreen's swipe-to-reply uses,
// needed here because CropOverlay's corner handles never had anything
// tappable to conflict with.
function DraggableSticker({ sticker, canvasSize, onChange, onDelete, onDragStart, onDragMove, onDragEnd, children }) {
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scaleAnim = useRef(new Animated.Value(sticker.scale || 1)).current;
  const [measured, setMeasured] = useState({ width: 0, height: 0 });

  // Mirrors the latest sticker/canvasSize into refs so the ONE PanResponder
  // (created once, lazy-init like CropOverlay's) always reads current
  // values instead of a stale closure from whichever render first mounted it.
  const stickerRef = useRef(sticker);
  stickerRef.current = sticker;
  const canvasSizeRef = useRef(canvasSize);
  canvasSizeRef.current = canvasSize;

  const dragBaseRef = useRef({ x: sticker.x, y: sticker.y });
  const scaleBaseRef = useRef(sticker.scale || 1);
  const pinchDistRef = useRef(null);
  // Two-finger rotation, tracked the same way pinch-to-resize tracks
  // distance: snapshot the two-touch angle at gesture start, then the
  // running delta (current angle - start angle) added to the sticker's
  // rotation AT START (rotationBaseRef) gives the new absolute rotation.
  // rotation has no Animated.Value of its own (the transform reads
  // sticker.rotation straight from the prop - see the render below), so
  // unlike scale it can only update live by committing to real state on
  // every move event, not just on release.
  const pinchAngleRef = useRef(null);
  const rotationBaseRef = useRef(sticker.rotation || 0);
  const draggingRef = useRef(false);
  const nearTrashRef = useRef(false);
  const liveXYRef = useRef({ x: sticker.x, y: sticker.y });
  const liveScaleRef = useRef(sticker.scale || 1);
  // gestureState.dx/dy are cumulative from the touch that started the WHOLE
  // gesture, not from the moment a 2nd finger lifts - so if a pinch drops
  // back to a single-finger drag mid-gesture, using raw gs.dx/dy directly
  // would jump the sticker to wherever that original finger has drifted to.
  // These track how many touches were active last move, and an offset to
  // subtract from gs.dx/dy once the drag "restarts" from the pinch's last
  // on-screen position.
  const touchCountRef = useRef(0);
  const dxOffsetRef = useRef(0);
  const dyOffsetRef = useRef(0);

  const panResponderRef = useRef(null);
  if (!panResponderRef.current) {
    panResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (evt, gs) =>
        evt.nativeEvent.touches.length === 2 || Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onMoveShouldSetPanResponderCapture: (evt, gs) =>
        evt.nativeEvent.touches.length === 2 || Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onPanResponderGrant: (evt) => {
        dragBaseRef.current = { x: stickerRef.current.x, y: stickerRef.current.y };
        scaleBaseRef.current = stickerRef.current.scale || 1;
        rotationBaseRef.current = stickerRef.current.rotation || 0;
        liveXYRef.current = { ...dragBaseRef.current };
        liveScaleRef.current = scaleBaseRef.current;
        pan.setValue({ x: 0, y: 0 });
        dxOffsetRef.current = 0;
        dyOffsetRef.current = 0;
        const touches = evt.nativeEvent.touches;
        touchCountRef.current = touches.length;
        if (touches.length === 2) {
          pinchDistRef.current = touchDistance(touches[0], touches[1]);
          pinchAngleRef.current = touchAngle(touches[0], touches[1]);
        } else {
          pinchDistRef.current = null;
          pinchAngleRef.current = null;
        }
      },
      onPanResponderMove: (evt, gs) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length === 2) {
          touchCountRef.current = 2;
          const dist = touchDistance(touches[0], touches[1]);
          const angle = touchAngle(touches[0], touches[1]);
          if (pinchDistRef.current == null || pinchAngleRef.current == null) {
            pinchDistRef.current = dist;
            pinchAngleRef.current = angle;
          } else if (pinchDistRef.current > 0) {
            const nextScale = clamp(scaleBaseRef.current * (dist / pinchDistRef.current), 0.5, 3.0);
            const nextRotation = rotationBaseRef.current + (angle - pinchAngleRef.current);
            liveScaleRef.current = nextScale;
            scaleAnim.setValue(nextScale);
            // rotation has no Animated.Value to drive it live without a
            // re-render (see the ref comment above) - onChange during move
            // is the only way to make the twist visually track the fingers
            // in real time, not just snap into place on release.
            onChange(stickerRef.current.id, { rotation: nextRotation });
          }
          return;
        }
        pinchDistRef.current = null;
        pinchAngleRef.current = null;
        const { width, height } = canvasSizeRef.current;
        if (!width || !height) return;
        if (touchCountRef.current === 2) {
          // Just dropped from a pinch back to a single finger - gs.dx/dy are
          // cumulative from the ORIGINAL touch-down, not from here, so
          // re-baseline against where the sticker actually is right now.
          dragBaseRef.current = { ...liveXYRef.current };
          dxOffsetRef.current = gs.dx;
          dyOffsetRef.current = gs.dy;
        }
        touchCountRef.current = touches.length;
        if (!draggingRef.current) {
          draggingRef.current = true;
          onDragStart(stickerRef.current.id);
        }
        const effDx = gs.dx - dxOffsetRef.current;
        const effDy = gs.dy - dyOffsetRef.current;
        pan.setValue({ x: effDx, y: effDy });
        const nx = clamp(dragBaseRef.current.x + effDx / width, 0, 1);
        const ny = clamp(dragBaseRef.current.y + effDy / height, 0, 1);
        liveXYRef.current = { x: nx, y: ny };
        const nearTrashNow = ny > TRASH_THRESHOLD_Y;
        if (nearTrashNow !== nearTrashRef.current) {
          nearTrashRef.current = nearTrashNow;
          onDragMove(stickerRef.current.id, nearTrashNow);
        }
      },
      onPanResponderRelease: () => {
        pinchDistRef.current = null;
        pinchAngleRef.current = null;
        if (draggingRef.current) {
          draggingRef.current = false;
          onDragEnd(stickerRef.current.id);
          if (nearTrashRef.current) {
            onDelete(stickerRef.current.id);
          } else {
            onChange(stickerRef.current.id, { x: liveXYRef.current.x, y: liveXYRef.current.y, scale: liveScaleRef.current });
            pan.setValue({ x: 0, y: 0 });
          }
          nearTrashRef.current = false;
        } else if (liveScaleRef.current !== scaleBaseRef.current) {
          // Rotation was already committed live during move (see above) -
          // only scale still needs a final commit here for a pinch-only
          // gesture (one that never crossed the single-finger-drag
          // threshold).
          onChange(stickerRef.current.id, { scale: liveScaleRef.current });
        }
      },
      onPanResponderTerminate: () => {
        pinchDistRef.current = null;
        pinchAngleRef.current = null;
        if (draggingRef.current) {
          draggingRef.current = false;
          onDragEnd(stickerRef.current.id);
          nearTrashRef.current = false;
        }
        pan.setValue({ x: 0, y: 0 });
        scaleAnim.setValue(scaleBaseRef.current);
        // Unlike scale (only ever visual until release, see above),
        // rotation gets committed to real state on every move event, so an
        // ABORTED gesture (a call coming in mid-twist, say) needs to
        // explicitly revert it back to where it started - otherwise the
        // partial rotation would be left stuck in state despite the
        // gesture never completing.
        if (stickerRef.current.rotation !== rotationBaseRef.current) {
          onChange(stickerRef.current.id, { rotation: rotationBaseRef.current });
        }
      },
    });
  }

  const left = sticker.x * canvasSize.width - measured.width / 2;
  const top = sticker.y * canvasSize.height - measured.height / 2;

  return (
    <Animated.View
      {...panResponderRef.current.panHandlers}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setMeasured((m) => (m.width === width && m.height === height ? m : { width, height }));
      }}
      style={[
        styles.stickerWrap,
        {
          left, top,
          transform: [
            { translateX: pan.x }, { translateY: pan.y },
            { scale: scaleAnim },
            { rotate: `${sticker.rotation || 0}rad` },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function LocationStickerContent({ sticker }) {
  return (
    <View style={styles.pill}>
      {sticker.content == null ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <>
          <Ionicons name="location" size={12} color={colors.textPrimary} />
          <Text style={styles.pillText} numberOfLines={1}>{sticker.content}</Text>
        </>
      )}
    </View>
  );
}

function TimeStickerContent({ sticker }) {
  return (
    <View style={styles.pill}>
      <Ionicons name="time-outline" size={12} color={colors.textPrimary} />
      <Text style={styles.pillText}>{sticker.content}</Text>
    </View>
  );
}

function PollStickerContent({ sticker, onContentChange }) {
  const question = sticker.content?.question || '';
  const options = sticker.content?.options || ['', ''];
  return (
    <View style={styles.pollCard}>
      <TextInput
        style={styles.pollQuestionInput}
        placeholder="Ask a question..."
        placeholderTextColor={colors.textMuted}
        value={question}
        onChangeText={(v) => onContentChange({ question: v, options })}
        maxLength={200}
      />
      {[0, 1].map((idx) => (
        <TextInput
          key={idx}
          style={styles.pollOptionInput}
          placeholder={`Option ${idx + 1}`}
          placeholderTextColor={colors.textMuted}
          value={options[idx]}
          onChangeText={(v) => {
            const next = [...options];
            next[idx] = v;
            onContentChange({ question, options: next });
          }}
          maxLength={80}
        />
      ))}
    </View>
  );
}

function TextStickerContent({ sticker, editing, onStartEdit, onChangeText, onFinishEdit }) {
  if (editing) {
    return (
      <TextInput
        autoFocus
        style={styles.textStickerInput}
        value={sticker.content}
        onChangeText={onChangeText}
        onBlur={onFinishEdit}
        multiline
        maxLength={120}
      />
    );
  }
  return (
    <TouchableOpacity onPress={onStartEdit} activeOpacity={0.85} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
      <Text style={styles.textStickerText}>{sticker.content || 'Tap to edit'}</Text>
    </TouchableOpacity>
  );
}

function StatusVideoPreview({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.mediaPreview}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

export default function StatusCreatorScreen({ token, onDone }) {
  const [mode, setMode] = useState('photo');
  const [posting, setPosting] = useState(false);

  // Text mode
  const [text, setText] = useState('');
  const [bgColorIndex, setBgColorIndex] = useState(0);

  // Photo / Video mode
  const [photoUri, setPhotoUri] = useState(null);
  const [videoUri, setVideoUri] = useState(null);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [caption, setCaption] = useState('');

  // Canvas + stickers
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [stickers, setStickers] = useState([]);
  const [editingStickerId, setEditingStickerId] = useState(null);
  const [draggingStickerId, setDraggingStickerId] = useState(null);
  const [trashHover, setTrashHover] = useState(false);

  // Sticker menu sheet
  const [stickerMenuVisible, setStickerMenuVisible] = useState(false);
  const sheetY = useRef(new Animated.Value(320)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  // Trash zone show/hide + hover pulse
  const trashScale = useRef(new Animated.Value(0)).current;
  const trashPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    StatusBar.setBarStyle('light-content');
    return () => { StatusBar.setBarStyle('dark-content'); };
  }, []);

  useEffect(() => {
    Animated.spring(trashScale, {
      toValue: draggingStickerId ? 1 : 0,
      friction: 6, tension: 80, useNativeDriver: true,
    }).start();
  }, [draggingStickerId, trashScale]);

  useEffect(() => {
    Animated.spring(trashPulse, {
      toValue: trashHover ? 1.25 : 1,
      friction: 5, tension: 100, useNativeDriver: true,
    }).start();
  }, [trashHover, trashPulse]);

  const handleCanvasLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    canvasSizeRef.current = { width, height };
    setCanvasSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const pickMedia = useCallback(async (kind) => {
    setPickingMedia(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', `We need access to your ${kind === 'video' ? 'videos' : 'photos'} to post an update.`);
        return;
      }
      if (kind === 'photo') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.base64) { Alert.alert('Error', 'Could not read the photo.'); return; }
        const dataUri = `data:image/jpeg;base64,${asset.base64}`;
        if (approxKb(dataUri) > MAX_IMAGE_KB) {
          Alert.alert('Photo too large', `About ${approxKb(dataUri)}KB. Try a smaller photo.`);
          return;
        }
        setPhotoUri(dataUri);
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'], videoMaxDuration: 30,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.uri) { Alert.alert('Error', 'Could not read the video.'); return; }
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const ext = (asset.uri.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
        const mime = ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
        const dataUri = `data:${mime};base64,${base64}`;
        if (approxKb(dataUri) > MAX_VIDEO_KB) {
          Alert.alert('Video too large', `About ${approxKb(dataUri)}KB. Try a shorter clip.`);
          return;
        }
        setVideoUri(dataUri);
      }
    } catch (err) {
      Alert.alert('Error', err.message || `Could not pick a ${kind}.`);
    } finally {
      setPickingMedia(false);
    }
  }, []);

  // Auto-launch the picker the first time Photo/Video is entered.
  useEffect(() => {
    if (mode === 'photo' && !photoUri && !pickingMedia) pickMedia('photo');
    if (mode === 'video' && !videoUri && !pickingMedia) pickMedia('video');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Tap-only mode switch - see BUG 2 in the task history: the old
  // scroll-driven carousel (ScrollView + onScroll updating an Animated.Value
  // via JS-thread setValue on every frame, plus a handler that always
  // snapped back to the same rest offset) was laggy and never actually felt
  // like it went anywhere. Four plain buttons, no ScrollView, no scroll
  // tracking, no lag.
  const goToMode = useCallback((key) => {
    setMode(key);
  }, []);

  // --- Stickers ------------------------------------------------------

  const addSticker = useCallback((partial) => {
    const id = nextStickerId();
    setStickers((prev) => [...prev, { id, x: 0.5, y: 0.42, scale: 1, rotation: 0, ...partial }]);
    return id;
  }, []);

  const updateSticker = useCallback((id, patch) => {
    setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const updateStickerContent = useCallback((id, content) => {
    setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, content } : s)));
  }, []);

  const deleteSticker = useCallback((id) => {
    setStickers((prev) => prev.filter((s) => s.id !== id));
    setEditingStickerId((cur) => (cur === id ? null : cur));
  }, []);

  const handleDragStart = useCallback((id) => setDraggingStickerId(id), []);
  const handleDragMove = useCallback((_id, isNearTrash) => setTrashHover(isNearTrash), []);
  const handleDragEnd = useCallback(() => { setDraggingStickerId(null); setTrashHover(false); }, []);

  const openStickerMenu = () => {
    setStickerMenuVisible(true);
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const closeStickerMenu = () => {
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 320, duration: 220, useNativeDriver: true }),
      Animated.timing(overlayOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) setStickerMenuVisible(false); });
  };

  const addLocationSticker = async () => {
    closeStickerMenu();
    const id = addSticker({ type: 'location', content: null });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        deleteSticker(id);
        Alert.alert('Permission needed', 'We need location access to add your location.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          { headers: { 'User-Agent': NOMINATIM_USER_AGENT } }
        );
        const data = await res.json();
        if (data?.display_name) address = data.display_name.split(',').slice(0, 2).join(',').trim();
      } catch (e) { /* keep the lat/lon fallback */ }
      updateSticker(id, { content: address, meta: { address, latitude, longitude } });
    } catch (err) {
      deleteSticker(id);
      Alert.alert('Could not get your location', err.message || 'Make sure location services are on.');
    }
  };

  const addTimeSticker = () => {
    closeStickerMenu();
    addSticker({ type: 'time', content: formatTimeDate(new Date()) });
  };

  const addPollSticker = () => {
    closeStickerMenu();
    addSticker({ type: 'poll', content: { question: '', options: ['', ''] }, x: 0.5, y: 0.5 });
  };

  const addTextSticker = () => {
    closeStickerMenu();
    const id = addSticker({ type: 'text', content: '' });
    setEditingStickerId(id);
  };

  // --- Post ------------------------------------------------------------

  const buildPayload = () => {
    if (mode === 'text') {
      if (!text.trim()) return { error: 'Write something before posting.' };
      return { payload: { content_type: 'text', content: text.trim(), bg_color: BG_COLORS[bgColorIndex] } };
    }

    const dataUri = mode === 'photo' ? photoUri : videoUri;
    if (!dataUri) return { error: `Pick a ${mode} first.` };

    const payload = { content_type: mode === 'photo' ? 'image' : mode, content: dataUri };

    const locationSticker = stickers.find((s) => s.type === 'location' && s.meta);
    if (locationSticker) payload.location = locationSticker.meta;

    if (stickers.some((s) => s.type === 'time')) payload.show_time = true;

    const pollSticker = stickers.find((s) => {
      if (s.type !== 'poll') return false;
      const q = s.content?.question?.trim();
      const opts = s.content?.options || [];
      return q && opts.length === 2 && opts.every((o) => o?.trim());
    });
    if (pollSticker) {
      payload.poll_data = {
        question: pollSticker.content.question.trim(),
        options: pollSticker.content.options.map((o) => o.trim()),
      };
    }

    // Free-floating text stickers have no backend field of their own (see
    // the file-header note) - fold their words into the caption rather than
    // dropping them silently.
    const textStickerWords = stickers
      .filter((s) => s.type === 'text' && s.content?.trim())
      .map((s) => s.content.trim());
    const fullCaption = [caption.trim(), ...textStickerWords].filter(Boolean).join(' - ');
    if (fullCaption) payload.caption = fullCaption.slice(0, 300);

    return { payload };
  };

  const canPost = useMemo(() => {
    if (mode === 'text') return !!text.trim();
    return !!(mode === 'photo' ? photoUri : videoUri);
  }, [mode, text, photoUri, videoUri]);

  const handlePost = async () => {
    if (posting || !canPost) return;
    const { payload, error } = buildPayload();
    if (error) { Alert.alert('Not ready to post', error); return; }
    setPosting(true);
    try {
      await createStatus(token, payload);
      onDone();
    } catch (err) {
      Alert.alert('Could not post update', err.message || 'Try again.');
    } finally {
      setPosting(false);
    }
  };

  const mediaUri = mode === 'photo' ? photoUri : mode === 'video' ? videoUri : null;
  const fullScreenBg = mode === 'text' ? BG_COLORS[bgColorIndex] : '#000000';
  const showStickerMenuButton = mode === 'text' || !!mediaUri;
  const showCaptionInput = (mode === 'photo' || mode === 'video') && !!mediaUri;
  const showRepickButton = (mode === 'photo' || mode === 'video') && !!mediaUri;

  const renderCanvasContent = () => {
    if (mode === 'text') {
      return (
        <View style={styles.textCanvas}>
          <TextInput
            style={[styles.textInput, { fontSize: textFontSize(text.length) }]}
            placeholder="Type a status"
            placeholderTextColor="rgba(255,255,255,0.6)"
            multiline
            maxLength={TEXT_MAX_LEN}
            value={text}
            onChangeText={setText}
            textAlign="center"
            autoFocus
          />
        </View>
      );
    }

    // photo / video
    if (mediaUri) {
      return mode === 'photo' ? (
        <Image source={{ uri: mediaUri }} style={styles.mediaPreview} resizeMode="cover" />
      ) : (
        <StatusVideoPreview uri={mediaUri} />
      );
    }

    return (
      <TouchableOpacity style={styles.mediaEmpty} activeOpacity={0.85} onPress={() => pickMedia(mode)} disabled={pickingMedia}>
        {pickingMedia ? (
          <ActivityIndicator size="large" color="#fff" />
        ) : (
          <>
            <Ionicons name={mode === 'photo' ? 'image-outline' : 'videocam-outline'} size={64} color="rgba(255,255,255,0.4)" />
            <Text style={styles.mediaEmptyText}>Tap to choose a {mode}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.flexRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={[styles.container, { backgroundColor: fullScreenBg }]}>

        {/* Canvas: media/text fills edge to edge, stickers float above it. */}
        <View style={styles.canvas} onLayout={handleCanvasLayout}>
          {renderCanvasContent()}

          {canvasSize.width > 0 && (
            <View style={styles.stickerLayer} pointerEvents="box-none">
              {stickers.map((sticker) => (
                <DraggableSticker
                  key={sticker.id}
                  sticker={sticker}
                  canvasSize={canvasSize}
                  onChange={updateSticker}
                  onDelete={deleteSticker}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                >
                  {sticker.type === 'location' && <LocationStickerContent sticker={sticker} />}
                  {sticker.type === 'time' && <TimeStickerContent sticker={sticker} />}
                  {sticker.type === 'poll' && (
                    <PollStickerContent sticker={sticker} onContentChange={(c) => updateStickerContent(sticker.id, c)} />
                  )}
                  {sticker.type === 'text' && (
                    <TextStickerContent
                      sticker={sticker}
                      editing={editingStickerId === sticker.id}
                      onStartEdit={() => setEditingStickerId(sticker.id)}
                      onChangeText={(v) => updateSticker(sticker.id, { content: v })}
                      onFinishEdit={() => setEditingStickerId(null)}
                    />
                  )}
                </DraggableSticker>
              ))}
            </View>
          )}

          {/* Trash zone - appears while any sticker is being dragged. */}
          <View style={styles.trashZoneWrap} pointerEvents="none">
            <Animated.View
              style={[
                styles.trashZone,
                trashHover && styles.trashZoneHover,
                { transform: [{ scale: trashScale }, { scale: trashPulse }] },
              ]}
            >
              <Ionicons name="trash-outline" size={28} color="#fff" />
            </Animated.View>
          </View>

        {/* Top bar */}
        <View style={[styles.topBar, { top: TOP_INSET }]}>
          <TouchableOpacity style={styles.circleBtn} onPress={onDone} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>

          {showStickerMenuButton ? (
            <TouchableOpacity style={styles.circleBtn} onPress={openStickerMenu} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={styles.circleBtnGhost} />
          )}

          {posting ? (
            <View style={styles.postSlot}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : (
            <TouchableOpacity
              style={styles.postSlot}
              onPress={handlePost}
              disabled={!canPost}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.postText, !canPost && styles.postTextDisabled]}>Post</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Re-pick button, below the close button */}
        {showRepickButton && (
          <TouchableOpacity
            style={[styles.circleBtn, styles.repickBtn, { top: TOP_INSET + 48 }]}
            onPress={() => pickMedia(mode)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="images-outline" size={20} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Text mode: char counter above the swatch row, swatch row above the carousel */}
        {mode === 'text' && (
          <Text style={styles.charCounter}>{text.length}/{TEXT_MAX_LEN}</Text>
        )}
        {mode === 'text' && (
          <View style={styles.swatchRow}>
            {BG_COLORS.map((c, idx) => {
              const active = idx === bgColorIndex;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setBgColorIndex(idx)}
                  activeOpacity={0.85}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={[styles.swatch, { backgroundColor: c }, active && styles.swatchActive]}
                />
              );
            })}
          </View>
        )}

        {/* Caption input, photo/video only */}
        {showCaptionInput && (
          <View style={styles.captionRow}>
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption..."
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={caption}
              onChangeText={setCaption}
              maxLength={300}
            />
          </View>
        )}

        {/* Sticker menu bottom sheet - moved inside the canvas wrapper below
            with everything else canvas-scoped; a native <Modal> renders in
            its own OS-level layer regardless of JSX nesting, so this is
            purely organizational for it, not a functional stacking fix. */}
        <Modal visible={stickerMenuVisible} transparent animationType="none" onRequestClose={closeStickerMenu}>
          <Animated.View style={[styles.sheetOverlay, { opacity: overlayOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeStickerMenu} />
            <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}>
              <View style={styles.sheetHandle} />
              {STICKER_MENU_ITEMS.map((item, idx) => (
                <TouchableOpacity
                  key={item.title}
                  style={[styles.sheetRow, idx < STICKER_MENU_ITEMS.length - 1 && styles.sheetRowBorder]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (item.type === 'location') addLocationSticker();
                    else if (item.type === 'time') addTimeSticker();
                    else if (item.type === 'poll') addPollSticker();
                    else addTextSticker();
                  }}
                >
                  <Ionicons name={item.icon} size={22} color={colors.accent} style={styles.sheetRowIcon} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetRowTitle}>{item.title}</Text>
                    <Text style={styles.sheetRowSubtitle}>{item.subtitle}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.sheetCancel} onPress={closeStickerMenu} activeOpacity={0.7}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </Modal>
        </View>

        {/* Mode carousel - always in normal flow at the bottom, a sibling
            of the canvas View above (not nested inside it, not absolutely
            positioned) so it's guaranteed to render below everything else
            with no overlap regardless of what the canvas is showing. */}
        <View style={styles.carouselBar}>
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.carouselBtn, active && styles.carouselBtnActive]}
                onPress={() => goToMode(m.key)}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                <Text style={[styles.carouselLabel, active && styles.carouselLabelActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flexRoot: { flex: 1 },
  container: { flex: 1 },
  canvas: { flex: 1, overflow: 'hidden' },
  stickerLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  stickerWrap: { position: 'absolute' },

  // --- Top bar ---
  topBar: {
    position: 'absolute', left: 0, right: 0, zIndex: 30,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  circleBtnGhost: { width: 40, height: 40 },
  repickBtn: { position: 'absolute', left: spacing.lg },
  postSlot: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  postText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  postTextDisabled: { color: 'rgba(255,255,255,0.4)' },

  // --- Trash zone ---
  trashZoneWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 96,
    alignItems: 'center', zIndex: 15,
  },
  trashZone: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(229,62,62,0.9)',
    justifyContent: 'center', alignItems: 'center',
  },
  trashZoneHover: { backgroundColor: colors.danger },

  // --- Text mode ---
  textCanvas: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  textInput: { color: '#fff', fontWeight: '600', textAlign: 'center', maxHeight: '70%' },
  // Positioned relative to `container` (sibling of swatchRow, not nested
  // inside textCanvas) so it stacks predictably above the swatch row
  // instead of depending on canvas-height math - bottom:58 + swatch height
  // (~40 at its largest, active state) puts the row's top edge around
  // y=98 from the screen bottom; this sits comfortably above that.
  charCounter: {
    position: 'absolute', bottom: 106, right: spacing.lg, zIndex: 15,
    color: 'rgba(255,255,255,0.6)', fontSize: 11,
  },
  swatchRow: {
    position: 'absolute', bottom: 58, left: 0, right: 0, zIndex: 15,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.md,
  },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  swatchActive: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, borderColor: '#fff' },

  // --- Photo/Video mode ---
  mediaPreview: { width: '100%', height: '100%' },
  mediaEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  mediaEmptyText: { color: 'rgba(255,255,255,0.7)', marginTop: spacing.md, fontSize: 15, fontWeight: '500' },

  // Same bottom as swatchRow (just above the 48px carousel, 10px gap) -
  // caption only shows for photo/video, swatch only for text, so they never
  // coexist and sharing the value is fine.
  captionRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 58, zIndex: 15 },
  captionInput: {
    backgroundColor: 'rgba(0,0,0,0.45)', color: '#fff', borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: 14,
  },

  // --- Sticker rendering ---
  pill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    minHeight: 28, ...shadow.md,
  },
  pillText: { marginLeft: 6, color: colors.textPrimary, fontSize: 12, fontWeight: '600', maxWidth: 220 },
  pollCard: {
    width: 260, backgroundColor: '#fff', borderRadius: radii.md,
    padding: spacing.md, ...shadow.md,
  },
  pollQuestionInput: {
    fontSize: 15, fontWeight: '600', color: colors.textPrimary,
    paddingVertical: 4, marginBottom: spacing.sm, textAlign: 'center',
  },
  pollOptionInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    paddingVertical: 8, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
    fontSize: 14, color: colors.textPrimary,
  },
  textStickerText: {
    color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
  },
  textStickerInput: {
    color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minWidth: 120, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.6)',
  },

  // --- Mode carousel ---
  carouselBar: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  carouselBtn: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
  },
  carouselBtnActive: {
    backgroundColor: '#fff',
  },
  carouselLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.6)',
  },
  carouselLabelActive: {
    color: '#000',
    fontWeight: '800',
  },

  // --- Sticker menu sheet ---
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', zIndex: 25 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.sm,
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  sheetRow: { flexDirection: 'row', alignItems: 'center', height: 64 },
  sheetRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetRowIcon: { marginRight: spacing.md, width: 22 },
  sheetRowTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sheetRowSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  sheetCancel: {
    marginTop: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.surface, alignItems: 'center',
  },
  sheetCancelText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
});
