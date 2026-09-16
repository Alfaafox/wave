import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Image, Alert, ActivityIndicator,
  Modal, Clipboard, Animated, Keyboard, PanResponder, Share, Linking, ScrollView
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
// manipulateAsync (not the new useImageManipulator hook - that can't be
// called from an event handler, only from a component's render body) is
// still fully supported, just marked @deprecated in favour of the
// contextual API. It explicitly accepts a base64 data: URI - which is
// exactly what stagedImage always is (see processAndSendImage) - not just a
// local file:// path, so no extra file write/read round-trip is needed.
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  AudioModule, RecordingPresets, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus
} from 'expo-audio';
import { VideoView, useVideoPlayer } from 'expo-video';
import { getMessages, getConversations, setConversationMute, setPrivateChat, searchMessages, starMessage, unstarMessage, pinMessage, unpinMessage, getPinnedMessages, uploadFile, getFileUrl, blockUser, SERVER_URL } from '../utils/api';
import { connectSocket } from '../utils/socket';
import { ReactionPicker, ReactionPills } from '../components/MessageReactions';
import MediaPickerSheet from '../components/MediaPickerSheet';
import ImageViewerModal from '../components/ImageViewerModal';
import ViewOnceViewer from '../components/ViewOnceViewer';
import UserProfileModal from '../components/UserProfileModal';
import PinnedMessagesModal from '../components/PinnedMessagesModal';
import ContactNotificationSettings from './ContactNotificationSettings';
import SharedMediaScreen from './SharedMediaScreen';
import TypingIndicator from '../components/TypingIndicator';
import { colors, spacing, radii, typography, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { WALLPAPER_STORAGE_KEY, AUTOSAVE_STORAGE_KEY, getWallpaperColor } from '../utils/chatPreferences';
import { getMuteCache, setMuteCache } from '../utils/contactPrefs';
import { fileIconFor, formatFileSize } from '../utils/fileDisplay';
import FilePreviewScreen from './FilePreviewScreen';
import LocationPickerScreen from './LocationPickerScreen';

const EDIT_DELETE_WINDOW_MS = 15 * 60 * 1000;

// View-once photo timer pills (1:1 only). value 0 = no timer (stays open until
// closed); 1/3/5/10 = seconds before the viewer auto-closes. The first label
// is the infinity sign written as a Unicode escape, never a raw glyph.
const VIEW_ONCE_PILLS = [
  { value: 0, label: '\u221E' },
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
];

// Swipe-to-reply tuning.
const SWIPE_MAX = 80;        // translation is clamped here
const SWIPE_THRESHOLD = 60;  // release past this fires the reply

// File sharing (Session 18). Mirrors the server's ALLOWED_TYPES
// (fileStorage.js) - kept here too so a bad pick is rejected instantly,
// before spending any upload bandwidth; the server re-validates regardless.
const ALLOWED_DOC_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'audio/mpeg',
  'audio/mp3',
  'video/mp4',
];
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function truncate(text, max) {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

// One-line preview for a pinned message (bar + modal).
function pinSnippet(p) {
  if (!p) return '';
  if (p.message_type === 'image') return 'Photo';
  if (p.message_type === 'video') return 'Video';
  if (p.message_type === 'audio') return 'Voice message';
  if (p.message_type === 'location') return 'Location';
  if (p.message_type === 'file') return p.content || 'Document';
  return (p.content || '').replace(/\s+/g, ' ').trim() || 'Message';
}

// --- Date separators between messages ---------------------------------------
// SQLite returns UTC timestamps as "YYYY-MM-DD HH:MM:SS" - no 'T', no 'Z'.
// new Date() on that string is unreliable (Hermes can mis-parse a non-ISO
// string, which made weeks-old messages resolve to ~now and show as "Today"),
// so normalise to strict ISO-8601 UTC first - same trick the edit/delete
// window uses elsewhere in this file.
function parseTs(raw) {
  const s = String(raw || '').replace(' ', 'T');
  const hasTz = s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTz ? s : `${s}Z`);
}

// Date-only key in the LOCAL timezone (time component stripped before compare).
function toDateKey(date) {
  const d = date instanceof Date ? date : parseTs(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Calendar-day key used only for grouping consecutive messages.
function dayKey(raw) {
  return toDateKey(raw);
}

// WhatsApp/Signal/Telegram-style separator label:
//   today -> "Today", yesterday -> "Yesterday", last 6 days -> "Monday",
//   older this year -> "Mon, 4 Aug", earlier year -> "Mon, 4 Aug 2025".
function formatDateSeparator(raw) {
  const d = parseTs(raw);
  if (Number.isNaN(d.getTime())) return '';

  const key = toDateKey(d);
  if (key === toDateKey(new Date())) return 'Today';
  if (key === toDateKey(new Date(Date.now() - 86400000))) return 'Yesterday';

  // 2..6 days back -> weekday name. startOfDay() makes this a date-only
  // comparison and stays correct across DST.
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays >= 2 && diffDays <= 6) return d.toLocaleDateString([], { weekday: 'long' });

  const weekday = d.toLocaleDateString([], { weekday: 'short' });
  const month = d.toLocaleDateString([], { month: 'short' });
  const base = `${weekday}, ${d.getDate()} ${month}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

// Pure: returns a new array with { type:'dateSeparator', date, id } objects
// inserted wherever the calendar day changes between consecutive messages.
// Keyed by the label ('sep_<label>') so it is stable across re-renders.
function insertDateSeparators(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages || [];
  const out = [];
  let lastKey = null;
  for (const m of messages) {
    if (!m || !m.created_at) { out.push(m); continue; }
    const key = dayKey(m.created_at);
    if (key && key !== lastKey) {
      const label = formatDateSeparator(m.created_at);
      out.push({ type: 'dateSeparator', date: label, id: `sep_${label}` });
      lastKey = key;
    }
    out.push(m);
  }
  return out;
}

// Wraps one message bubble with a right-swipe-to-reply gesture. Detection is a
// memoised RN PanResponder (matching the project's existing PanResponder
// convention - UserProfileModal / ImageViewerModal); the slide + the reply-icon
// fade/scale run on the UI thread via reanimated shared values, so a drag never
// touches the JS thread or re-renders the FlatList. Right-swipe only; vertical
// drags are handed back to the list so scrolling is unaffected.
function SwipeableMessage({ enabled, onTriggerReply, children }) {
  const translateX = useSharedValue(0);
  const triggerRef = useRef(onTriggerReply);
  triggerRef.current = onTriggerReply;

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const iconStyle = useAnimatedStyle(() => {
    const p = Math.min(Math.max(translateX.value, 0) / SWIPE_THRESHOLD, 1);
    return { opacity: p, transform: [{ scale: 0.5 + 0.5 * p }] };
  });

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // activeOffsetX [10, Infinity] + failOffsetY [-10, 10] + right-only +
        // single finger. Returning false leaves the touch with the FlatList.
        onMoveShouldSetPanResponder: (evt, g) => {
          if (!enabled) return false;
          if (evt.nativeEvent.touches.length > 1) return false;
          return g.dx > 10 && Math.abs(g.dy) < 10;
        },
        onPanResponderMove: (evt, g) => {
          translateX.value = Math.min(Math.max(g.dx, 0), SWIPE_MAX);
        },
        onPanResponderRelease: (evt, g) => {
          const reached = g.dx >= SWIPE_THRESHOLD;
          translateX.value = withSpring(0, { stiffness: 200, damping: 20, mass: 0.6 });
          // Haptic feedback would fire here on `reached`; expo-haptics is not
          // installed and a require() of a missing module fails at Metro bundle
          // time (see CLAUDE.md), so it is intentionally skipped.
          if (reached && enabled && triggerRef.current) triggerRef.current();
        },
        onPanResponderTerminate: () => {
          translateX.value = withSpring(0, { stiffness: 200, damping: 20, mass: 0.6 });
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [enabled, translateX]
  );

  return (
    <View style={styles.swipeRow} {...(enabled ? responder.panHandlers : {})}>
      <Reanimated.View style={[styles.swipeReplyIcon, iconStyle]} pointerEvents="none">
        <Ionicons name="arrow-undo" size={18} color={colors.accent} />
      </Reanimated.View>
      <Reanimated.View style={rowStyle}>{children}</Reanimated.View>
    </View>
  );
}

// Render a search-result message preview with the matched term bolded. Only
// the first occurrence is highlighted; a leading "..." marks a trimmed start.
function renderSnippet(text, query) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const q = (query || '').trim();
  if (!q) return <Text style={styles.srSnippet} numberOfLines={2}>{clean}</Text>;
  const idx = clean.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <Text style={styles.srSnippet} numberOfLines={2}>{clean}</Text>;
  const from = Math.max(0, idx - 24);
  const pre = (from > 0 ? '...' : '') + clean.slice(from, idx);
  const mid = clean.slice(idx, idx + q.length);
  const post = clean.slice(idx + q.length);
  return (
    <Text style={styles.srSnippet} numberOfLines={2}>
      {pre}<Text style={styles.srSnippetMatch}>{mid}</Text>{post}
    </Text>
  );
}

function AudioBubble({ uri, isMine }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) { player.pause(); } else { player.seekTo(0); player.play(); }
  };
  return (
    <TouchableOpacity style={styles.audioRow} onPress={toggle}>
      <Ionicons
        name={status.playing ? 'pause' : 'play'}
        size={20}
        color={isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText}
        style={styles.audioIcon}
      />
      <Text style={[styles.audioLabel, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
        Voice message
      </Text>
    </TouchableOpacity>
  );
}

// message_type === 'video' (normal, not view-once): an inline player the
// same footprint as the image bubble. Native play/pause/scrub controls;
// the built-in fullscreen button is disabled deliberately - no new
// full-screen video viewer was asked for here, and expo-video's fullscreen
// mode is a separate native surface this app hasn't vetted the way
// callManager.js/CallScreen.js vetted RTCView against RN's own <Modal>.
function VideoBubble({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={styles.messageImage}
      contentFit="cover"
      nativeControls
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
    />
  );
}

// message_type === 'file'. `item.file_name` / `file_mime_type` / `file_size`
// come from the LEFT JOIN message_files in GET /:id/messages (and are already
// on the object the server broadcasts after a successful upload); `content`
// is the same filename as a plain-text fallback if those are ever missing.
function FileBubble({ item, isMine, downloading, onPress }) {
  const name = item.file_name || item.content || 'File';
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  const iconColor = isMine ? colors.bubbleOutgoingText : colors.accent;
  return (
    <TouchableOpacity style={styles.fileRow} onPress={onPress} disabled={downloading} activeOpacity={0.7}>
      <View style={[styles.fileIconWrap, isMine ? styles.fileIconWrapMine : styles.fileIconWrapTheirs]}>
        {downloading
          ? <ActivityIndicator size="small" color={iconColor} />
          : <Ionicons name={fileIconFor(item.file_mime_type, name)} size={26} color={iconColor} />}
      </View>
      <View style={styles.fileTextCol}>
        <Text style={[styles.fileName, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.fileMeta, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
          {ext}{item.file_size ? ` \u00B7 ${formatFileSize(item.file_size)}` : ''}
        </Text>
      </View>
      <Ionicons name="download-outline" size={16} color={isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted} />
    </TouchableOpacity>
  );
}

// message_type === 'location'. content is JSON:
//   one-shot pin:   { latitude, longitude, address? }
//   live share:     { latitude, longitude, live, durationMs, expiresAt }
// (see LocationPickerScreen.js / ChatScreen's startLiveLocation). A live
// share's lat/lng/live get patched in place as liveLocation:update /
// liveLocation:ended events land (see the socket handlers below) - this
// component always just renders whatever's currently in item.content, live
// or not. No map thumbnail: this app has no maps API key requirement (it
// uses MapLibre + OSM tiles for the picker screen itself) but a *rendered*
// static thumbnail image would still need a key-less tile/static-map
// service, and the only ones available are unauthenticated demo endpoints
// not fit to depend on for a real feature - so the card is address/
// coordinates + a tap that hands off to the device's own maps app.
function LocationBubble({ item, isMine, onPress, onStopLiveShare }) {
  let coords = null;
  try { coords = JSON.parse(item.content); } catch (e) { /* leave null */ }
  const valid = coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number';

  if (!valid) {
    return (
      <Text style={[styles.bubbleText, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
        Location unavailable
      </Text>
    );
  }

  // durationMs is only ever present on a message that WAS (or still is) a
  // live share - distinguishes "ended live share" from "always-was-static".
  const wasLiveShare = coords.durationMs !== undefined;
  const isLive = coords.live === true;
  const expiresLabel = isLive && coords.expiresAt && !Number.isNaN(new Date(coords.expiresAt).getTime())
    ? new Date(coords.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const subtitle = isLive
    ? (expiresLabel ? `Live until ${expiresLabel}` : 'Live location')
    : wasLiveShare
    ? 'Live location ended'
    : (coords.address || `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
  const iconColor = isLive ? colors.online : (isMine ? colors.bubbleOutgoingText : colors.accent);

  return (
    <View>
      <TouchableOpacity style={styles.fileRow} onPress={() => onPress(coords)} activeOpacity={0.7}>
        <View style={[styles.fileIconWrap, isMine ? styles.fileIconWrapMine : styles.fileIconWrapTheirs]}>
          <Ionicons name={wasLiveShare ? 'navigate' : 'location'} size={24} color={iconColor} />
        </View>
        <View style={styles.fileTextCol}>
          <Text style={[styles.fileName, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
            {wasLiveShare ? 'Live location' : 'Location'}
          </Text>
          <Text style={[styles.fileMeta, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Ionicons name="open-outline" size={16} color={isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted} />
      </TouchableOpacity>
      {isMine && isLive && (
        <TouchableOpacity onPress={onStopLiveShare} style={styles.stopLiveShareRow} activeOpacity={0.7}>
          <Text style={[styles.stopLiveShareText, { color: isMine ? colors.bubbleOutgoingText : colors.accent }]}>
            Stop sharing
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Crop overlay for the staged-image modal (see applyCrop / imageRect in
// ChatScreen). `layout` is the actual visible-image rect in points
// (already letterbox-corrected by the caller); cropRegion is normalized
// 0-1 against that rect. Corner handles drag via PanResponder.
//
// gestureState.dx/dy are cumulative from the START of the current touch,
// not per-frame deltas - so every move must be computed from a FIXED
// snapshot of cropRegion taken at gesture start (dragStartRef), never from
// the cropRegion prop itself. Re-deriving from the live prop would double
// count: cropRegion updates (and CropOverlay re-renders) on every move
// event, so the next move's cumulative dx would land on top of a base that
// already includes the previous moves' deltas.
function CropOverlay({ layout, initialCropRegion, onCropChange }) {
  const minSize = 0.1;
  // Local state drives re-renders of THIS component only - not ChatScreen.
  const [cropRegion, setCropRegion] = useState(initialCropRegion);
  const dragStartRef = useRef(null);
  const cropRegionRef = useRef(cropRegion);
  cropRegionRef.current = cropRegion;

  // Sync when crop mode is re-opened with a new initial region.
  useEffect(() => {
    setCropRegion(initialCropRegion);
  }, [initialCropRegion.x, initialCropRegion.y, initialCropRegion.width, initialCropRegion.height]);

  // Lazy-init ref: the reducer (4x PanResponder.create()) must run exactly
  // ONCE for the lifetime of this component. Seeding useRef(expr) directly
  // does NOT achieve that - the expr argument is still evaluated on every
  // render (only the assignment is skipped after the first), so it would
  // silently rebuild and throw away 4 PanResponders on every re-render.
  // The `if (!x.current)` guard is what actually makes it run once.
  const panRespondersRef = useRef(null);
  if (!panRespondersRef.current) {
    panRespondersRef.current = ['tl', 'tr', 'bl', 'br'].reduce((acc, corner) => {
      acc[corner] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = { ...cropRegionRef.current };
        },
        onPanResponderMove: (_, gs) => {
          if (!dragStartRef.current || !layout.width || !layout.height) return;
          const dx = gs.dx / layout.width;
          const dy = gs.dy / layout.height;
          const { x, y, width, height } = dragStartRef.current;
          let next;
          if (corner === 'tl') {
            const newX = Math.max(0, Math.min(x + dx, x + width - minSize));
            const newY = Math.max(0, Math.min(y + dy, y + height - minSize));
            next = { x: newX, y: newY, width: width + (x - newX), height: height + (y - newY) };
          } else if (corner === 'tr') {
            const newW = Math.max(minSize, Math.min(width + dx, 1 - x));
            const newY = Math.max(0, Math.min(y + dy, y + height - minSize));
            next = { x, y: newY, width: newW, height: height + (y - newY) };
          } else if (corner === 'bl') {
            const newX = Math.max(0, Math.min(x + dx, x + width - minSize));
            const newH = Math.max(minSize, Math.min(height + dy, 1 - y));
            next = { x: newX, y, width: width + (x - newX), height: newH };
          } else {
            const newW = Math.max(minSize, Math.min(width + dx, 1 - x));
            const newH = Math.max(minSize, Math.min(height + dy, 1 - y));
            next = { x, y, width: newW, height: newH };
          }
          setCropRegion(next);
        },
        onPanResponderRelease: () => {
          // Only notify the parent on release - zero parent re-renders during drag.
          if (cropRegionRef.current) onCropChange(cropRegionRef.current);
          dragStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragStartRef.current = null;
        },
      });
      return acc;
    }, {});
  }
  const panResponders = panRespondersRef.current;

  const left = cropRegion.x * layout.width;
  const top = cropRegion.y * layout.height;
  const width = cropRegion.width * layout.width;
  const height = cropRegion.height * layout.height;
  const handleSize = 22;
  const half = handleSize / 2;

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height }} pointerEvents="box-none">
      <View style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: top, backgroundColor: 'rgba(0,0,0,0.5)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left: 0, top: top + height, width: layout.width, height: layout.height - top - height, backgroundColor: 'rgba(0,0,0,0.5)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left: 0, top, width: left, height, backgroundColor: 'rgba(0,0,0,0.5)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left: left + width, top, width: layout.width - left - width, height, backgroundColor: 'rgba(0,0,0,0.5)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left, top, width, height, borderWidth: 1.5, borderColor: '#fff' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left: left + width / 3, top, width: 0.5, height, backgroundColor: 'rgba(255,255,255,0.3)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left: left + (width * 2) / 3, top, width: 0.5, height, backgroundColor: 'rgba(255,255,255,0.3)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left, top: top + height / 3, width, height: 0.5, backgroundColor: 'rgba(255,255,255,0.3)' }} pointerEvents="none" />
      <View style={{ position: 'absolute', left, top: top + (height * 2) / 3, width, height: 0.5, backgroundColor: 'rgba(255,255,255,0.3)' }} pointerEvents="none" />
      {[
        { corner: 'tl', l: left - half, t: top - half },
        { corner: 'tr', l: left + width - half, t: top - half },
        { corner: 'bl', l: left - half, t: top + height - half },
        { corner: 'br', l: left + width - half, t: top + height - half },
      ].map(({ corner, l, t }) => (
        <View
          key={corner}
          {...panResponders[corner].panHandlers}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{
            position: 'absolute', left: l, top: t,
            width: handleSize, height: handleSize,
            backgroundColor: '#fff', borderRadius: 3,
          }}
        />
      ))}
    </View>
  );
}

export default function ChatScreen({ token, currentUser, conversationId, otherUser, isGroup, groupName, presenceMap, onBack, onStartCall, jumpToMessageId, initialDraft }) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  // Pre-fills the input when opened from a Status reply (App.js
  // handleStartChatFromStatus) - read once as the initial state value, not
  // synced on every re-render, so typing normally still works.
  const [input, setInput] = useState(initialDraft || '');
  // 3-state typing indicator for whoever last started typing in this chat.
  //   state: 'gone' | 'typing' | 'paused'
  const [typing, setTyping] = useState({ state: 'gone', userId: null, name: '' });
  const [sendingImage, setSendingImage] = useState(false);
  const [sendingCameraImage, setSendingCameraImage] = useState(false);
  const [sendingVideo, setSendingVideo] = useState(false);
  // File sharing / location sharing (Session 18). attachMenuOpen shows the
  // Photo & Video / Document / Location popover the paperclip button opens
  // (it used to jump straight to the gallery picker). downloadingFileId is
  // the message id currently being fetched to open (single at a time is
  // fine - tapping a second file while one is downloading is rare enough
  // not to need a Set).
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(0);
  const [downloadingFileId, setDownloadingFileId] = useState(null);
  // Polls (group chats only). showPollCreator opens the full-screen poll
  // composer from the attach menu; pollQuestion/pollOptions are its draft.
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  // WhatsApp-style confirmation step: pickDocument stages the picked asset
  // here instead of uploading immediately - FilePreviewScreen is rendered
  // as a full-screen overlay while this is set (see the render tree below,
  // same conditional-overlay pattern as sharedMediaOpen).
  const [fileToConfirm, setFileToConfirm] = useState(null);
  // Location sharing (Session 19). showLocationPicker renders
  // LocationPickerScreen as the same kind of full-screen overlay.
  // liveShare tracks the ONE live share this device may currently be
  // broadcasting - { messageId, subscription } (subscription is the
  // expo-location watchPositionAsync handle) or null. Mirrored into a ref
  // because the mount/unmount effect below needs to stop the watcher on
  // unmount without a stale closure over the state value at mount time.
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [liveShare, setLiveShare] = useState(null);
  const liveShareRef = useRef(null);
  liveShareRef.current = liveShare;
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [actionMenuFor, setActionMenuFor] = useState(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [forwardPickerFor, setForwardPickerFor] = useState(null);
  const [forwardTargets, setForwardTargets] = useState([]);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);
  const [savingViewerImage, setSavingViewerImage] = useState(false);
  // View-once photo/video compose flow (1:1 only). `stagedImage` / `stagedVideo`
  // is a picked photo or recorded video held before send so the timer pills
  // can be chosen (only one of the two is ever set at a time); `viewOnceDuration`
  // is null (off) or 0/1/3/5/10. `viewOnceViewing` is the message currently
  // open in the full-screen ViewOnceViewer.
  const [stagedImage, setStagedImage] = useState(null);
  const [stagedVideo, setStagedVideo] = useState(null);
  const [viewOnceDuration, setViewOnceDuration] = useState(null);
  const [viewOnceViewing, setViewOnceViewing] = useState(null);
  // Full-screen staged-image preview modal (1:1 only, see the Modal below the
  // old stagedBar). stagedCaption is local to that modal; showViewOnceOptions
  // just toggles its timer-pill bottom sheet - the timer value itself still
  // lives on the existing viewOnceDuration state above, shared with video.
  const [stagedCaption, setStagedCaption] = useState('');
  const [showViewOnceOptions, setShowViewOnceOptions] = useState(false);
  // Crop tool for the staged-image modal. cropRegion is normalized (0-1)
  // against the actual VISIBLE image content, not the preview box - see
  // imageRect below, which accounts for resizeMode="contain" letterboxing.
  // imageLayout = the <Image>'s own layout box; imageDimensions = the
  // photo's natural pixel size (from onLoad).
  const [cropMode, setCropMode] = useState(false);
  // Final crop region lives in a ref, not state - ChatScreen must never
  // re-render because of the drag itself. CropOverlay owns its own internal
  // state for the smooth 60fps drag and only calls onCropChange (writing
  // here) once, on release.
  const cropRegionRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const [imageLayout, setImageLayout] = useState({ width: 0, height: 0 });
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [applyingCrop, setApplyingCrop] = useState(false);

  // The <Image> box and the photo's own aspect ratio rarely match, so
  // resizeMode="contain" letterboxes/pillarboxes it - the crop overlay has
  // to sit over the actual rendered pixels, not the full box, or dragging a
  // handle into the letterboxed margin would map to a crop rectangle that
  // doesn't correspond to real image content.
  const imageRect = useMemo(() => {
    const { width: boxW, height: boxH } = imageLayout;
    const { width: imgW, height: imgH } = imageDimensions;
    if (!boxW || !boxH || !imgW || !imgH) return { left: 0, top: 0, width: 0, height: 0 };
    const boxAspect = boxW / boxH;
    const imgAspect = imgW / imgH;
    let width, height;
    if (imgAspect > boxAspect) {
      width = boxW;
      height = boxW / imgAspect;
    } else {
      height = boxH;
      width = boxH * imgAspect;
    }
    return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
  }, [imageLayout.width, imageLayout.height, imageDimensions.width, imageDimensions.height]);
  const [wallpaperColor, setWallpaperColor] = useState(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [contactMuted, setContactMuted] = useState(false);
  // Pinned messages for this conversation (max 3, server-enforced). Seeded
  // from GET /conversations/:id/pinned on mount, kept live by the
  // pinnedMessage / unpinnedMessage socket events. `hidePinBar` dismisses the
  // bar for this screen session only (does NOT unpin).
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [hidePinBar, setHidePinBar] = useState(false);
  const [pinnedModalOpen, setPinnedModalOpen] = useState(false);
  // Private Chat mode for this conversation (server-backed, on conversations
  // .private_chat). Seeded from GET /conversations on mount, kept live by the
  // privateChatEnabled / privateChatDisabled socket events. 1:1 only.
  const [privateChat, setPrivateChatState] = useState(false);
  // In-conversation message search (FTS5-backed, GET /conversations/:id/search).
  // `searchMode` transforms the header; results show in an absolute overlay.
  // `resultsCollapsed` = a result was tapped/stepped-to, overlay hidden but
  // still in search mode (a slim nav bar stays under the header).
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const autoSaveRef = useRef(false);
  const listRef = useRef(null);
  // The message id we last auto-scrolled to for a deep link (from Starred
  // Messages). messages.id is globally unique, so comparing the value is
  // enough to fire the jump exactly once per distinct target.
  const lastJumpedIdRef = useRef(null);
  const socketRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const searchReqIdRef = useRef(0);
  // Flash highlight on the message a search result points at (fades over 1.5s).
  const highlightAnim = useRef(new Animated.Value(0)).current;
  // Receiver-side safety timer (auto typing->pause after 4s, pause->gone after 30s).
  const typingTimeoutRef = useRef(null);
  // Sender-side: timestamp of the last typing:start emit (throttle to 1/sec)
  // and the pending "emit typing:pause 1.5s after the last keystroke" timer.
  const typingStartSentRef = useRef(0);
  const pauseEmitRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  // Reply preview bar slide-up (0 = hidden below, 1 = in place).
  const replyBarAnim = useRef(new Animated.Value(0)).current;

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) console.warn('Microphone permission not granted');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const [savedWallpaper, savedAutoSave] = await Promise.all([
        AsyncStorage.getItem(WALLPAPER_STORAGE_KEY),
        AsyncStorage.getItem(AUTOSAVE_STORAGE_KEY),
      ]);
      setWallpaperColor(getWallpaperColor(savedWallpaper));
      autoSaveRef.current = savedAutoSave === 'true';
    })();
  }, []);

  // Per-conversation notification mute. Server-backed
  // (conversation_members.mute_notifications, enforced by the push service);
  // AsyncStorage is only a device cache so the toggle is instant on modal
  // open. State is lifted here so the toggle in UserProfileModal and the one
  // in ContactNotificationSettings stay in sync. 1:1 chats only for now.
  const muteTouchedRef = useRef(false);
  useEffect(() => {
    if (isGroup || !otherUser?.id) return;
    let cancelled = false;
    getMuteCache(conversationId).then((v) => { if (!cancelled) setContactMuted(v); });
    return () => { cancelled = true; };
  }, [isGroup, otherUser?.id, conversationId]);

  // `opts.skipSync` = the value came FROM the server (modal reconcile on open):
  // update local state + cache only, and never let it override a toggle the
  // user has already made this session.
  const handleMuteChange = async (value, opts = {}) => {
    if (opts.skipSync) {
      if (muteTouchedRef.current) return;
    } else {
      muteTouchedRef.current = true;
    }
    setContactMuted(value);
    setMuteCache(conversationId, value);
    if (opts.skipSync || !conversationId) return;
    try {
      await setConversationMute(token, conversationId, value);
    } catch (e) {
      // the server didn't get it, so push would still fire - roll the UI back
      setContactMuted(!value);
      setMuteCache(conversationId, !value);
      Alert.alert('Could not update', 'Check your connection and try again.');
    }
  };

  useEffect(() => {
    if (replyTo) {
      replyBarAnim.setValue(0);
      Animated.spring(replyBarAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
    }
  }, [replyTo]);

  const handleSwipeReply = useCallback((message) => {
    setReplyTo(message);
  }, []);

  useEffect(() => {
    if (recorderState.isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorderState.isRecording]);

  useEffect(() => {
    let isMounted = true;
    setHidePinBar(false); // a re-hidden bar shouldn't stay hidden in a new chat
    setPinnedModalOpen(false);

    getMessages(token, conversationId).then((data) => {
      if (isMounted) setMessages(data);
    });

    getPinnedMessages(token, conversationId)
      .then((data) => { if (isMounted) setPinnedMessages(Array.isArray(data?.pins) ? data.pins : []); })
      .catch(() => { if (isMounted) setPinnedMessages([]); });

    // Seed Private Chat state (1:1 only). GET /conversations is the same call
    // UserProfileModal makes; the privateChat* socket events keep it live.
    if (!isGroup) {
      getConversations(token).then((list) => {
        if (!isMounted) return;
        const conv = (Array.isArray(list) ? list : []).find((c) => String(c.id) === String(conversationId));
        if (conv) setPrivateChatState(!!conv.private_chat);
      }).catch(() => {});
    }

    const socket = connectSocket(token);
    socketRef.current = socket;
    socket.emit('joinConversation', conversationId, (response) => {
      if (!response?.ok) console.warn('Failed to join conversation:', response?.error);
    });

    // The user we're currently showing an indicator for. Kept in a ref (not
    // just state) so socket handlers and safety timers can read/compare it
    // synchronously without a stale closure.
    let shownTyperId = null;
    const goGone = () => {
      shownTyperId = null;
      clearTimeout(typingTimeoutRef.current);
      setTyping({ state: 'gone', userId: null, name: '' });
    };
    // Receiver safety net: without a follow-up event, TYPING self-demotes to
    // PAUSED after 4s, and PAUSED disappears after 30s.
    const armTypingSafety = (fromState) => {
      clearTimeout(typingTimeoutRef.current);
      if (fromState === 'typing') {
        typingTimeoutRef.current = setTimeout(() => {
          setTyping((cur) => (cur.state === 'typing' ? { ...cur, state: 'paused' } : cur));
          typingTimeoutRef.current = setTimeout(goGone, 30000);
        }, 4000);
      } else if (fromState === 'paused') {
        typingTimeoutRef.current = setTimeout(goGone, 30000);
      }
    };

    const handleMessage = (msg) => {
      if (msg.conversationId === conversationId) {
        setMessages((prev) => [...prev, msg]);
        if (msg.user_id !== currentUser.id) {
          // We're reading this chat right now - tell the server so the
          // conversation-list unread badge is already zero when we go back
          // (joinConversation only marks read on mount).
          socketRef.current?.emit('markRead', conversationId);
          if (shownTyperId == null || shownTyperId === msg.user_id) {
            goGone();
          }
        }

        if (
          autoSaveRef.current && msg.message_type === 'image'
          && msg.user_id !== currentUser.id
          && msg.view_once_duration == null && msg.content
        ) {
          MediaLibrary.saveToLibraryAsync(msg.content).catch((err) => {
            console.warn('Auto-save failed:', err.message);
          });
        }
      }
    };
    const handleTypingStart = ({ conversationId: cid, userId: uid, name }) => {
      if (cid !== conversationId || uid === currentUser.id) return;
      shownTyperId = uid;
      setTyping({ state: 'typing', userId: uid, name: name || '' });
      armTypingSafety('typing');
    };
    const handleTypingPause = ({ conversationId: cid, userId: uid, name }) => {
      if (cid !== conversationId || uid === currentUser.id) return;
      shownTyperId = uid;
      setTyping({ state: 'paused', userId: uid, name: name || '' });
      armTypingSafety('paused');
    };
    const handleTypingStop = ({ conversationId: cid, userId: uid }) => {
      if (cid !== conversationId || uid === currentUser.id) return;
      // Ignore a stop from someone who isn't the one we're showing (e.g. a
      // different group member who just sent a message).
      if (shownTyperId == null || shownTyperId === uid) goGone();
    };
    const handleDelivered = ({ conversationId: cid, messageIds }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, delivered: 1 } : m)));
    };
    const handleRead = ({ conversationId: cid, messageIds }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, read: 1 } : m)));
    };
    const handleEdited = ({ conversationId: cid, messageId, newContent }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: newContent, edited: 1 } : m)));
    };
    const handleDeletedForEveryone = ({ conversationId: cid, messageId }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => {
        if (m.id === messageId) return { ...m, deleted_for_everyone: 1, content: '' };
        // Any message quoting the just-deleted one now shows "This message was
        // deleted" in its quote (server also returns reply_deleted on refetch).
        if (m.reply_to_id === messageId) return { ...m, reply_deleted: 1 };
        return m;
      }));
    };
    const handleReactionUpdate = ({ conversationId: cid, messageId, reactions }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    };
    const handleMessageViewed = ({ conversationId: cid, messageId }) => {
      if (String(cid) !== String(conversationId)) return;
      setMessages((prev) => prev.map((m) => (
        m.id === messageId ? { ...m, view_once_viewed: 1, content: null } : m
      )));
    };
    const handlePrivateChatOn = ({ conversationId: cid }) => {
      if (String(cid) === String(conversationId)) setPrivateChatState(true);
    };
    const handlePrivateChatOff = ({ conversationId: cid }) => {
      if (String(cid) === String(conversationId)) setPrivateChatState(false);
    };
    const handlePinned = ({ conversationId: cid, pin }) => {
      if (String(cid) !== String(conversationId) || !pin) return;
      setPinnedMessages((prev) => (
        prev.some((p) => p.message_id === pin.message_id) ? prev : [pin, ...prev]
      ));
    };
    const handleUnpinned = ({ conversationId: cid, messageId }) => {
      if (String(cid) !== String(conversationId)) return;
      setPinnedMessages((prev) => prev.filter((p) => p.message_id !== messageId));
    };
    // Live location (Session 19): a position tick patches that one
    // message's content in place - never a new message, and never a
    // server round-trip to re-fetch (same "ephemeral event patches an
    // already-rendered message" pattern as handleReactionUpdate above).
    const patchLocationContent = (messageId, patch) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        let data;
        try { data = JSON.parse(m.content); } catch (e) { data = {}; }
        return { ...m, content: JSON.stringify({ ...data, ...patch }) };
      }));
    };
    const handleLiveLocationUpdate = ({ conversationId: cid, messageId, latitude, longitude }) => {
      if (String(cid) !== String(conversationId)) return;
      patchLocationContent(messageId, { latitude, longitude });
    };
    const handleLiveLocationEnded = ({ conversationId: cid, messageId }) => {
      if (String(cid) !== String(conversationId)) return;
      patchLocationContent(messageId, { live: false });
      // Only meaningful for the device that was actually sharing - a no-op
      // for every other member's liveShareRef, which is always null.
      if (liveShareRef.current?.messageId === messageId) {
        liveShareRef.current.subscription?.remove();
        setLiveShare(null);
      }
    };
    // Poll vote tallies. Server only emits this to the poll's own
    // conversation room, so no cid filter is needed here - it just patches
    // whichever loaded message (if any) carries that poll_id.
    const handlePollUpdated = ({ pollId, votes }) => {
      setMessages((prev) => prev.map((m) => (
        m.poll_id === pollId ? { ...m, poll_votes: votes } : m
      )));
    };

    socket.on('message', handleMessage);
    socket.on('reactionUpdate', handleReactionUpdate);
    socket.on('messageViewed', handleMessageViewed);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:pause', handleTypingPause);
    socket.on('typing:stop', handleTypingStop);
    socket.on('delivered', handleDelivered);
    socket.on('read', handleRead);
    socket.on('messageEdited', handleEdited);
    socket.on('messageDeletedForEveryone', handleDeletedForEveryone);
    socket.on('privateChatEnabled', handlePrivateChatOn);
    socket.on('privateChatDisabled', handlePrivateChatOff);
    socket.on('pinnedMessage', handlePinned);
    socket.on('unpinnedMessage', handleUnpinned);
    socket.on('liveLocation:update', handleLiveLocationUpdate);
    socket.on('liveLocation:ended', handleLiveLocationEnded);
    socket.on('poll:updated', handlePollUpdated);

    return () => {
      isMounted = false;
      socket.off('message', handleMessage);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:pause', handleTypingPause);
      socket.off('typing:stop', handleTypingStop);
      socket.off('delivered', handleDelivered);
      socket.off('read', handleRead);
      socket.off('messageEdited', handleEdited);
      socket.off('messageDeletedForEveryone', handleDeletedForEveryone);
      socket.off('reactionUpdate', handleReactionUpdate);
      socket.off('messageViewed', handleMessageViewed);
      socket.off('privateChatEnabled', handlePrivateChatOn);
      socket.off('privateChatDisabled', handlePrivateChatOff);
      socket.off('pinnedMessage', handlePinned);
      socket.off('unpinnedMessage', handleUnpinned);
      socket.off('liveLocation:update', handleLiveLocationUpdate);
      socket.off('liveLocation:ended', handleLiveLocationEnded);
      socket.off('poll:updated', handlePollUpdated);
      clearTimeout(typingTimeoutRef.current);
      clearTimeout(searchDebounceRef.current);
      // Leaving the chat (unmount) - tell the other side we're done typing,
      // and drop any pending "pause" emit.
      clearTimeout(pauseEmitRef.current);
      socket.emit('typing:stop', { conversationId });
      // Final catch-all read: covers a message that landed a beat before we
      // navigated back, so the list badge is right by the time it renders.
      socket.emit('markRead', conversationId);
      // NOTE: this stops the local GPS watch (so this device stops ticking
      // updates) but deliberately does NOT emit liveLocation:stop - leaving
      // the chat isn't the user asking to stop sharing. The share itself
      // keeps existing and will still expire on schedule server-side
      // (its setTimeout doesn't depend on this socket or this screen); it
      // just won't tick fresh positions until the chat is reopened, since
      // nothing currently lifts the GPS watch above ChatScreen's lifetime.
      liveShareRef.current?.subscription?.remove();
    };
  }, [conversationId, token]);

  // Sending, editing, or leaving the chat ends our typing state on the other
  // side immediately (a real 'typing:stop', not just a decay).
  const emitTypingStop = () => {
    clearTimeout(pauseEmitRef.current);
    typingStartSentRef.current = 0; // next keystroke re-announces immediately
    socketRef.current?.emit('typing:stop', { conversationId });
  };

  const sendMessage = (content = input, messageType = 'text', caption) => {
    if (!content.trim() && messageType === 'text') return;
    if (!socketRef.current) {
      Alert.alert('Not connected', 'Reconnecting... try again in a second.');
      return;
    }

    // Sending from within search mode drops you back to the normal chat.
    if (searchMode) exitSearchMode();

    const payload = { conversationId, content, messageType };
    if (replyTo) payload.replyToId = replyTo.id;
    if (viewOnceDuration !== null) payload.view_once_duration = viewOnceDuration;
    if (caption) payload.caption = caption;

    socketRef.current.emit('message', payload, (response) => {
      if (!response?.ok) {
        Alert.alert('Message failed', response?.error || 'Could not send message. Try again.');
      }
    });

    emitTypingStop();
    if (messageType === 'text') setInput('');
    setReplyTo(null);
    // Staging + view-once are one-shot per send.
    setStagedImage(null);
    setStagedVideo(null);
    setViewOnceDuration(null);
  };

  // Staged video's send (small stagedBar above). Staged image has its own
  // sendStagedImage, triggered from the full-screen preview modal instead.
  const sendStagedMedia = () => {
    if (stagedVideo) sendMessage(stagedVideo, 'video');
  };
  const clearStagedMedia = () => {
    setStagedImage(null);
    setStagedVideo(null);
    setViewOnceDuration(null);
  };

  // Full-screen staged-image modal's OK/send. `caption` rides sendMessage's
  // payload.caption straight onto the image message itself - the server now
  // has a real caption column on messages (wired end to end on the backend),
  // so this no longer needs the confirmSendFile-style follow-up text message.
  const sendStagedImage = () => {
    sendMessage(stagedImage, 'image', stagedCaption);
    setStagedImage(null);
    setStagedCaption('');
    setViewOnceDuration(null);
    cancelCrop();
  };
  // Also the Modal's onRequestClose (Android back button) - reachable even
  // while cropMode is true (the button that calls this is hidden then, but
  // the hardware back button isn't), so crop state must reset here too or
  // the next staged image would open straight into a stale crop overlay.
  const cancelStagedImage = () => {
    setStagedImage(null);
    setStagedCaption('');
    setViewOnceDuration(null);
    cancelCrop();
  };

  const cancelCrop = () => {
    setCropMode(false);
    cropRegionRef.current = { x: 0, y: 0, width: 1, height: 1 };
  };

  // The final crop region lives in cropRegionRef (written once, on drag
  // release, by CropOverlay's onCropChange - see the ref requirements
  // above), not in ChatScreen state, so this reads .current rather than a
  // `cropRegion` variable. It's normalized against the actual image content
  // (imageRect), so it maps straight onto imageDimensions (the photo's
  // natural pixel size) with no further letterboxing correction needed here.
  const applyCrop = async () => {
    if (!stagedImage || !imageDimensions.width || applyingCrop) return;
    setApplyingCrop(true);
    try {
      const region = cropRegionRef.current;
      const originX = Math.round(region.x * imageDimensions.width);
      const originY = Math.round(region.y * imageDimensions.height);
      const width = Math.round(region.width * imageDimensions.width);
      const height = Math.round(region.height * imageDimensions.height);
      const result = await manipulateAsync(
        stagedImage,
        [{ crop: { originX, originY, width, height } }],
        { format: SaveFormat.JPEG, compress: 0.9, base64: true }
      );
      if (!result.base64) throw new Error('Could not read the cropped image.');
      setStagedImage(`data:image/jpeg;base64,${result.base64}`);
      cancelCrop();
    } catch (err) {
      Alert.alert('Crop failed', err.message);
    } finally {
      setApplyingCrop(false);
    }
  };

  const cancelPollCreator = () => {
    setShowPollCreator(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  };

  const submitPoll = () => {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (!q) return Alert.alert('Question required', 'Please enter a poll question.');
    if (opts.length < 2) return Alert.alert('More options needed', 'Add at least 2 options.');
    if (!socketRef.current) {
      Alert.alert('Not connected', 'Reconnecting... try again in a second.');
      return;
    }
    socketRef.current.emit('poll:create', { conversationId, question: q, options: opts }, (res) => {
      if (!res?.ok) return Alert.alert('Error', res?.error || 'Could not create poll.');
      cancelPollCreator();
    });
  };

  const handleTypingInput = (text) => {
    setInput(text);

    // typing:start on every keystroke, throttled to at most once per second.
    const now = Date.now();
    if (now - typingStartSentRef.current >= 1000) {
      typingStartSentRef.current = now;
      socketRef.current?.emit('typing:start', { conversationId });
    }

    // typing:pause 1.5s after the last keystroke if nothing else happens.
    clearTimeout(pauseEmitRef.current);
    pauseEmitRef.current = setTimeout(() => {
      socketRef.current?.emit('typing:pause', { conversationId });
    }, 1500);
  };

  const formatDuration = (ms) => {
    const totalSec = Math.floor((ms || 0) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const insertEmoji = (emoji) => setInput((prev) => prev + emoji);

  // GIFs and stickers are both just image URLs as far as this app's message
  // schema and rendering are concerned (see the message_type === 'image'
  // branch in the FlatList renderItem below) - so picking one just sends it
  // as a normal image message. No backend/db schema change needed for this.
  const handlePickMedia = (url) => {
    sendMessage(url, 'image');
    setShowEmojiBar(false);
  };

  const processAndSendImage = async (asset) => {
    if (!asset?.base64) {
      Alert.alert('Error', 'Could not read the image.');
      return;
    }
    const dataUri = `data:image/jpeg;base64,${asset.base64}`;
    const approxKb = Math.round((dataUri.length * 0.75) / 1024);
    if (approxKb > 3000) {
      Alert.alert('Image too large', `About ${approxKb}KB. Try a smaller photo.`);
      return;
    }
    // In a 1:1 chat, stage the photo so the view-once timer pills can be
    // chosen before it sends. Groups (no view-once) send straight away.
    if (isGroup) {
      sendMessage(dataUri, 'image');
    } else {
      setEditingMessage(null);
      setViewOnceDuration(null);
      // Reset so the Crop button's `!imageDimensions.width` guard stays
      // disabled until this image's own onLoad fires - otherwise a fast tap
      // could crop against the PREVIOUS staged photo's leftover dimensions.
      setImageDimensions({ width: 0, height: 0 });
      setStagedImage(dataUri);
    }
  };

  // Open a view-once photo/video. If it arrived over the socket while the chat
  // was open its content was withheld (the socket never carries view-once
  // media); fetch it - GET messages gates it to the unopened recipient.
  const openViewOnce = async (item) => {
    if (item.content) { setViewOnceViewing(item); return; }
    try {
      const fresh = await getMessages(token, conversationId);
      const found = (Array.isArray(fresh) ? fresh : []).find((m) => m.id === item.id);
      if (found && found.content) {
        setMessages((prev) => prev.map((m) => (m.id === item.id ? { ...m, content: found.content } : m)));
        setViewOnceViewing({ ...item, content: found.content });
        return;
      }
    } catch (e) { /* fall through */ }
    const label = item.message_type === 'video' ? 'video' : 'photo';
    Alert.alert(`${label[0].toUpperCase()}${label.slice(1)} unavailable`, `Could not load this ${label}. Try reopening the chat.`);
  };

  // Recorded-video counterpart to processAndSendImage. launchCameraAsync in
  // video mode gives a local file uri (no base64 option like the photo
  // picker), so this reads + base64-encodes it itself before building the
  // same data: URI convention every other media type in this app uses.
  const processAndSendVideo = async (asset) => {
    if (!asset?.uri) {
      Alert.alert('Error', 'Could not read the video.');
      return;
    }
    let dataUri;
    try {
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const ext = (asset.uri.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
      const mime = ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
      dataUri = `data:${mime};base64,${base64}`;
    } catch (err) {
      Alert.alert('Error', 'Could not read the video.');
      return;
    }
    const approxKb = Math.round((dataUri.length * 0.75) / 1024);
    if (approxKb > 6000) {
      Alert.alert('Video too large', `About ${approxKb}KB. Try a shorter recording.`);
      return;
    }
    // In a 1:1 chat, stage the video so the view-once timer pills can be
    // chosen before it sends. Groups (no view-once) send straight away.
    if (isGroup) {
      sendMessage(dataUri, 'video');
    } else {
      setEditingMessage(null);
      setViewOnceDuration(null);
      setStagedVideo(dataUri);
    }
  };

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need access to your photos to send images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.3, base64: true, allowsEditing: false
      });
      if (result.canceled) return;
      setSendingImage(true);
      await processAndSendImage(result.assets?.[0]);
      setSendingImage(false);
    } catch (err) {
      setSendingImage(false);
      Alert.alert('Error picking image', err.message);
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.3, base64: true, allowsEditing: false
      });
      if (result.canceled) return;
      setSendingCameraImage(true);
      await processAndSendImage(result.assets?.[0]);
      setSendingCameraImage(false);
    } catch (err) {
      setSendingCameraImage(false);
      Alert.alert('Error taking photo', err.message);
    }
  };

  // Attach menu -> Record Video. mediaTypes: ['videos'] (array syntax, not
  // the deprecated MediaTypeOptions) switches launchCameraAsync into video
  // mode; videoMaxDuration caps the clip so the base64 payload stays
  // reasonable (see the size guard in processAndSendVideo).
  const recordVideo = async () => {
    setAttachMenuOpen(false);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need camera access to record a video.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'], videoMaxDuration: 30,
      });
      if (result.canceled) return;
      setSendingVideo(true);
      await processAndSendVideo(result.assets?.[0]);
      setSendingVideo(false);
    } catch (err) {
      setSendingVideo(false);
      Alert.alert('Error recording video', err.message);
    }
  };

  // Document attach (attach menu -> Document). Just picks + validates the
  // asset and stages it - it no longer uploads on pick. WhatsApp pattern:
  // pick -> full-screen confirmation (FilePreviewScreen, rendered below
  // while fileToConfirm is set) -> user taps Send -> confirmSendFile.
  const pickDocument = async () => {
    setAttachMenuOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ALLOWED_DOC_MIME,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      if (asset.size && asset.size > MAX_FILE_BYTES) {
        Alert.alert('File too large', 'Files can be up to 25MB.');
        return;
      }
      setFileToConfirm(asset);
    } catch (err) {
      Alert.alert('Could not pick file', err.message || 'Try again.');
    }
  };

  // FilePreviewScreen's Send button. Uploaded over REST, not the socket -
  // see uploadFile() in api.js. No manual append to `messages` on success:
  // the server broadcasts the inserted message back over the socket
  // 'message' event to everyone already in the conversation room, including
  // us, so the existing handleMessage listener picks it up like any other
  // message. A non-empty caption isn't a field on the file message itself
  // (no server change in this pass) - it rides the existing text-message
  // path as a normal follow-up message right after, reusing sendMessage's
  // own socket.emit('message') logic rather than duplicating it.
  const confirmSendFile = async (caption) => {
    const asset = fileToConfirm;
    if (!asset) return;
    setSendingFile(true);
    setFileUploadProgress(0);
    try {
      await uploadFile(token, conversationId, asset, setFileUploadProgress);
      if (caption) sendMessage(caption, 'text');
      setFileToConfirm(null);
    } catch (err) {
      Alert.alert('Could not send file', err.message || 'Try again.');
    } finally {
      setSendingFile(false);
      setFileUploadProgress(0);
    }
  };

  const cancelFileConfirm = () => setFileToConfirm(null);

  // Attach menu -> Location. LocationPickerScreen (a full-screen overlay,
  // rendered below) does the actual picking - permission + initial GPS fix,
  // the map + fixed pin, debounced reverse geocode, and the static/live
  // choice. This just opens it.
  const openLocationPicker = () => {
    setAttachMenuOpen(false);
    setShowLocationPicker(true);
  };

  // LocationPickerScreen's "Send your current location". A one-shot pin,
  // not live tracking - sent as JSON over the existing socket 'message'
  // event (message_type: 'location'), same path a text message uses.
  const handleSendStaticLocation = ({ latitude, longitude, address }) => {
    setShowLocationPicker(false);
    sendMessage(JSON.stringify({ latitude, longitude, address }), 'location');
  };

  // LocationPickerScreen's duration picker. The initial share message goes
  // over the normal socket 'message' path (server validates the duration
  // and computes expiresAt - see server.js); once it's acked, this starts a
  // client-side GPS watch that ticks a `liveLocation:update` over the
  // socket roughly every 15s / 20m of movement for the rest of the
  // duration. Starting a new share while one is already running stops the
  // old one first - one live share per device at a time.
  const startLiveLocation = async ({ latitude, longitude, durationMs }) => {
    setShowLocationPicker(false);
    if (liveShareRef.current) stopLiveLocation();
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need location access to share your location.');
        return;
      }
      const content = JSON.stringify({ latitude, longitude, live: true, durationMs });
      socketRef.current?.emit('message', { conversationId, content, messageType: 'location' }, async (response) => {
        if (!response?.ok) {
          Alert.alert('Could not start live location', response?.error || 'Try again.');
          return;
        }
        const messageId = response.message.id;
        try {
          const subscription = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
            (pos) => {
              socketRef.current?.emit('liveLocation:update', {
                messageId,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              });
            }
          );
          setLiveShare({ messageId, subscription });
        } catch (watchErr) {
          Alert.alert('Could not track your location', watchErr.message || 'Try again.');
        }
      });
    } catch (err) {
      Alert.alert('Could not start live location', err.message || 'Try again.');
    }
  };

  // "Stop sharing" on one's own live-location bubble, or called internally
  // when starting a new share supersedes an old one. Stops the local GPS
  // watch immediately and tells the server, which persists the last known
  // position and broadcasts liveLocation:ended to the whole room (including
  // back to us - see server.js - so this device's own bubble updates the
  // same way everyone else's does, via handleLiveLocationEnded below,
  // rather than needing its own separate local-state update here).
  const stopLiveLocation = (messageId) => {
    const share = liveShareRef.current;
    if (!share || (messageId != null && share.messageId !== messageId)) return;
    share.subscription?.remove();
    socketRef.current?.emit('liveLocation:stop', { messageId: share.messageId });
    setLiveShare(null);
  };

  // Tapping a shared location opens it in the device's own maps app -
  // universal Google Maps search link works cross-platform (opens the Maps
  // app if installed, else the browser) without needing Linking scheme
  // detection for geo: vs Apple Maps.
  const openLocation = (coords) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${coords.latitude},${coords.longitude}`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open maps', 'No maps app is available.'));
  };

  // Tapping a file message: download once to cache (skip if already there),
  // then hand it to Android's native "Open with" app chooser via
  // ACTION_VIEW - expo-sharing's ACTION_SEND share sheet was the wrong
  // intent for this (it offers contacts/apps to send the file TO, not apps
  // that can open it), which is why a PDF tap didn't show Acrobat/Drive etc.
  // FileSystem.getContentUriAsync() hands ACTION_VIEW a content:// URI (the
  // same FileProvider expo-file-system already registers), which is
  // required - a bare file:// Uri is blocked by FLAG_GRANT_READ_URI_PERMISSION
  // on modern Android. IntentLauncher is Android-only, so iOS (not started
  // yet per CLAUDE.md) gets an explicit "not supported" message instead of a
  // silent crash.
  const openFileMessage = async (item) => {
    if (!item.file_id) {
      Alert.alert('File unavailable', 'This file could not be found.');
      return;
    }
    if (Platform.OS !== 'android') {
      Alert.alert('Not supported', 'Opening files is only supported on Android right now.');
      return;
    }
    const fileUrl = getFileUrl(conversationId, item.file_id);
    const safeName = (item.file_name || item.content || 'file').replace(/[^\w.\- ]/g, '_');
    const localUri = `${FileSystem.cacheDirectory}wave_file_${item.file_id}_${safeName}`;
    setDownloadingFileId(item.id);
    try {
      const info = await FileSystem.getInfoAsync(localUri);
      if (!info.exists) {
        await FileSystem.downloadAsync(fileUrl, localUri, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const contentUri = await FileSystem.getContentUriAsync(localUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: item.file_mime_type || 'application/octet-stream',
      });
    } catch (err) {
      // ActivityNotFoundException surfaces here when no app can handle the
      // mime type (e.g. no PDF viewer installed) - same failure a real
      // "Open with" chooser would hit, just reported via a thrown error
      // instead of its own empty-chooser UI.
      Alert.alert('Could not open file', 'No app found that can open this file type.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  // Stable (no closure over state/props) so it can be handed to
  // SharedMediaScreen without churning its memoised list renderers.
  const saveImage = useCallback(async (uri) => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need permission to save photos.');
        return;
      }
      // MediaLibrary needs a real local file with a proper extension - it
      // cannot save a base64 data URI or a remote https URL directly (this
      // is the actual cause of the "Could not get the file's extension"
      // error). Own photos/camera shots arrive as data URIs; GIFs/stickers
      // arrive as remote URLs (see MediaPickerSheet) - both need to become
      // a real local file first.
      let localUri = uri;

      if (uri.startsWith('data:')) {
        const match = uri.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) throw new Error('Unrecognized image data');
        const [, ext, base64Data] = match;
        const tempPath = `${FileSystem.cacheDirectory}wave_save_${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(tempPath, base64Data, { encoding: FileSystem.EncodingType.Base64 });
        localUri = tempPath;
      } else if (uri.startsWith('http://') || uri.startsWith('https://')) {
        const cleanPath = uri.split('?')[0];
        const ext = cleanPath.split('.').pop() || 'gif';
        const tempPath = `${FileSystem.cacheDirectory}wave_save_${Date.now()}.${ext}`;
        const downloadResult = await FileSystem.downloadAsync(uri, tempPath);
        localUri = downloadResult.uri;
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert('Saved', 'Image saved to your gallery.');
    } catch (err) {
      Alert.alert('Could not save image', err.message);
    }
  }, []);

  const startRecording = async () => {
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (err) {
      Alert.alert('Could not start recording', err.message);
    }
  };

  const stopRecordingAndSend = async () => {
    try {
      if (!recorderState.isRecording) return;
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const dataUri = `data:audio/m4a;base64,${base64}`;
      const approxKb = Math.round((dataUri.length * 0.75) / 1024);
      if (approxKb > 4000) {
        Alert.alert('Recording too long', 'Please keep voice messages shorter.');
        return;
      }
      sendMessage(dataUri, 'audio');
    } catch (err) {
      Alert.alert('Could not send recording', err.message);
    }
  };

  const cancelRecording = async () => {
    try {
      if (recorderState.isRecording) await audioRecorder.stop();
    } catch (e) {}
  };

  const openActionMenu = (message) => {
    if (message.deleted_for_everyone) return;
    setActionMenuFor(message);
  };

  const closeActionMenu = () => setActionMenuFor(null);

  // Export the whole loaded conversation as plain text via the OS share sheet.
  // System messages, deleted messages and raw media payloads are left out -
  // images/voice notes are represented by a short placeholder.
  const handleExportChat = async () => {
    setHeaderMenuOpen(false);
    const chatName = isGroup ? (groupName || 'Group chat') : (otherUser?.name || 'Chat');
    const lines = [...messages]
      .sort((a, b) => {
        const t = new Date(a.created_at) - new Date(b.created_at);
        return t !== 0 ? t : (Number(a.id) || 0) - (Number(b.id) || 0);
      })
      .filter((m) => m.message_type !== 'system' && !m.deleted_for_everyone)
      .map((m) => {
        const when = new Date(m.created_at).toLocaleString();
        const who = m.username || 'Unknown';
        let body;
        if (m.message_type === 'image') body = '[Image]';
        else if (m.message_type === 'video') body = '[Video]';
        else if (m.message_type === 'audio') body = '[Voice Message]';
        else if (m.message_type === 'file') body = `[Document: ${(m.content || 'file').trim()}]`;
        else if (m.message_type === 'location') body = '[Location]';
        else body = (m.content || '').trim();
        return `[${when}] ${who}: ${body}`;
      });

    if (lines.length === 0) {
      Alert.alert('Nothing to export', 'There are no messages in this chat yet.');
      return;
    }

    const text = `Wave chat export - ${chatName}\nExported ${new Date().toLocaleString()}\n\n${lines.join('\n')}`;
    try {
      await Share.share({ message: text });
    } catch (e) {
      // user dismissed the share sheet, or it is unavailable - nothing to do
    }
  };

  const handleReply = () => {
    setReplyTo(actionMenuFor);
    closeActionMenu();
  };

  const handleCopy = () => {
    if (actionMenuFor?.message_type === 'text') {
      Clipboard.setString(actionMenuFor.content);
    }
    closeActionMenu();
  };

  // messages.starred_by is a JSON array string of user ids (or null). A message
  // is "starred" for us when it contains our own id.
  const parseStarredBy = (raw) => {
    if (!raw) return [];
    try {
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  };
  const isMessageStarred = (item) => parseStarredBy(item?.starred_by).includes(currentUser.id);

  const handleToggleStar = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    if (!msg) return;
    const currentlyStarred = isMessageStarred(msg);
    const prevStarredBy = msg.starred_by ?? null;

    // Optimistic: flip our id in the local array immediately.
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      let arr = parseStarredBy(m.starred_by);
      arr = currentlyStarred ? arr.filter((n) => n !== currentUser.id) : [...arr, currentUser.id];
      return { ...m, starred_by: arr.length ? JSON.stringify(arr) : null };
    }));

    const call = currentlyStarred ? unstarMessage : starMessage;
    call(token, conversationId, msg.id).catch((err) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, starred_by: prevStarredBy } : m)));
      Alert.alert('Could not update', err.message);
    });
  };

  const isMessagePinned = (item) => pinnedMessages.some((p) => p.message_id === item?.id);

  const handleTogglePin = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    if (!msg) return;
    const currentlyPinned = isMessagePinned(msg);

    if (!currentlyPinned && pinnedMessages.length >= 3) {
      Alert.alert('Maximum 3 messages can be pinned', 'Unpin one first to pin this message.');
      return;
    }

    if (currentlyPinned) {
      const removed = pinnedMessages.find((p) => p.message_id === msg.id);
      setPinnedMessages((prev) => prev.filter((p) => p.message_id !== msg.id));
      unpinMessage(token, conversationId, msg.id).catch((err) => {
        if (removed) setPinnedMessages((prev) => (prev.some((p) => p.message_id === msg.id) ? prev : [removed, ...prev]));
        Alert.alert('Could not unpin', err.message);
      });
      return;
    }

    // Optimistic pin with a placeholder row; the API response (and the
    // pinnedMessage socket event) replace it with the real pin.
    const optimistic = {
      id: `tmp-${msg.id}`,
      message_id: msg.id,
      content: msg.content,
      message_type: msg.message_type,
      sender_name: msg.username,
      sender_id: msg.user_id,
      pinned_by: currentUser.id,
      pinned_at: new Date().toISOString(),
    };
    setPinnedMessages((prev) => [optimistic, ...prev]);
    pinMessage(token, conversationId, msg.id)
      .then((res) => {
        if (res?.pin) {
          setPinnedMessages((prev) => {
            const without = prev.filter((p) => p.message_id !== msg.id);
            return without.some((p) => p.message_id === msg.id) ? without : [res.pin, ...without];
          });
        }
      })
      .catch((err) => {
        setPinnedMessages((prev) => prev.filter((p) => p.message_id !== msg.id));
        Alert.alert(
          /maximum 3/i.test(err.message || '') ? 'Maximum 3 messages can be pinned' : 'Could not pin',
          /maximum 3/i.test(err.message || '') ? 'Unpin one first to pin this message.' : err.message
        );
      });
  };

  const handleUnpinFromModal = (pin) => {
    if (!pin) return;
    setPinnedMessages((prev) => prev.filter((p) => p.message_id !== pin.message_id));
    unpinMessage(token, conversationId, pin.message_id).catch((err) => {
      setPinnedMessages((prev) => (prev.some((p) => p.message_id === pin.message_id) ? prev : [pin, ...prev]));
      Alert.alert('Could not unpin', err.message);
    });
  };

  const jumpToPinned = (messageId) => {
    if (scrollToMessageId(messageId)) flashHighlight(messageId);
  };

  // Close the "all pinned messages" sheet once it no longer has >= 2 to show.
  useEffect(() => {
    if (pinnedModalOpen && pinnedMessages.length < 2) setPinnedModalOpen(false);
  }, [pinnedModalOpen, pinnedMessages.length]);

  const handleEdit = () => {
    const msg = actionMenuFor;
    const age = Date.now() - new Date(msg.created_at.replace(' ', 'T') + (msg.created_at.includes('Z') ? '' : 'Z')).getTime();
    if (age > EDIT_DELETE_WINDOW_MS) {
      Alert.alert('Too late', 'You can only edit messages within 15 minutes of sending.');
      closeActionMenu();
      return;
    }
    setEditingMessage(msg);
    setInput(msg.content);
    closeActionMenu();
  };

  const handleDeleteForMe = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    socketRef.current?.emit('deleteForMe', { messageId: msg.id }, (response) => {
      if (response?.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        Alert.alert('Error', response?.error || 'Could not delete message');
      }
    });
  };

  const handleDeleteForEveryone = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    socketRef.current?.emit('deleteForEveryone', { messageId: msg.id }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not delete for everyone', response?.error || 'Try again.');
      }
    });
  };

  const confirmDelete = () => {
    const msg = actionMenuFor;
    const isMine = msg.user_id === currentUser.id;
    const age = Date.now() - new Date(msg.created_at.replace(' ', 'T') + (msg.created_at.includes('Z') ? '' : 'Z')).getTime();
    const canDeleteForEveryone = isMine && age <= EDIT_DELETE_WINDOW_MS;

    closeActionMenu();
    const options = [{ text: 'Cancel', style: 'cancel' }];
    if (canDeleteForEveryone) {
      options.push({ text: 'Delete for everyone', style: 'destructive', onPress: () => doDeleteForEveryone(msg) });
    }
    options.push({ text: 'Delete for me', style: 'destructive', onPress: () => doDeleteForMe(msg) });

    Alert.alert('Delete message?', '', options);
  };

  const doDeleteForMe = (msg) => {
    socketRef.current?.emit('deleteForMe', { messageId: msg.id }, (response) => {
      if (response?.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        Alert.alert('Error', response?.error || 'Could not delete message');
      }
    });
  };

  const doDeleteForEveryone = (msg) => {
    socketRef.current?.emit('deleteForEveryone', { messageId: msg.id }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not delete for everyone', response?.error || 'Try again.');
      }
    });
  };

  const handleForward = async () => {
    const msg = actionMenuFor;
    closeActionMenu();
    // File messages carry a server-side file_id, not raw content - the
    // socket 'message' path forwarding below re-sends `content` as a plain
    // string, which would silently downgrade a forwarded file into a text
    // message showing just its filename. Not implemented yet rather than
    // implemented wrong.
    if (msg?.message_type === 'file') {
      Alert.alert('Cannot forward files yet', 'Forwarding documents is not supported yet.');
      return;
    }
    // A live share re-sent through the generic forward path below would
    // start a brand new live share in the target conversation - owned by
    // the forwarder, with a fresh full-duration timer, but with no GPS
    // watch behind it (only startLiveLocation arms one), so it would sit
    // there as "Live location" and never actually tick a position. A
    // static pin's content forwards fine as-is (WhatsApp disables
    // forwarding a live share entirely for the same reason).
    if (msg?.message_type === 'location') {
      let loc = null;
      try { loc = JSON.parse(msg.content); } catch (e) { /* leave null */ }
      if (loc?.live) {
        Alert.alert('Cannot forward a live location', 'Live location sharing cannot be forwarded.');
        return;
      }
    }
    try {
      const convos = await getConversations(token);
      setForwardTargets(convos.filter((c) => c.id !== conversationId));
      setForwardPickerFor(msg);
    } catch (err) {
      Alert.alert('Error', 'Could not load your chats to forward to.');
    }
  };

  const doForwardTo = (targetConversationId) => {
    const msg = forwardPickerFor;
    setForwardPickerFor(null);
    if (!socketRef.current || !msg) return;
    socketRef.current.emit(
      'message',
      { conversationId: targetConversationId, content: msg.content, messageType: msg.message_type },
      (response) => {
        if (response?.ok) {
          Alert.alert('Forwarded', 'Message forwarded.');
        } else {
          Alert.alert('Error', response?.error || 'Could not forward message');
        }
      }
    );
  };

  const handleToggleReaction = (messageId, emoji) => {
    socketRef.current?.emit('toggleReaction', { messageId, emoji }, (response) => {
      if (!response?.ok) {
        Alert.alert('Error', response?.error || 'Could not react to message');
      }
    });
  };

  const openReactionPicker = () => {
    setReactionPickerFor(actionMenuFor);
    closeActionMenu();
  };

  const submitEdit = () => {
    if (!editingMessage) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    socketRef.current?.emit('editMessage', { messageId: editingMessage.id, newContent: trimmed }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not edit', response?.error || 'Try again.');
      }
    });
    emitTypingStop();
    setEditingMessage(null);
    setInput('');
  };

  const cancelEdit = () => {
    emitTypingStop();
    setEditingMessage(null);
    setInput('');
  };

  const headerTitle = isGroup ? (groupName || 'Group') : (otherUser?.name || 'Chat');
  // Header avatar: the other party's picture for 1:1, else initials (first
  // letter of the name / group name) on the accent colour - same pattern as
  // ChatListScreen / UserProfileModal.
  const headerInitial = (headerTitle || '?').trim().charAt(0).toUpperCase() || '?';
  const headerAvatarUri = isGroup ? null : (otherUser?.profilePicture || null);

  // The other party's account state, from GET /conversations' `with.status`
  // ('active' | 'inactive' = deactivated | 'deleted'). When it's not active,
  // hide the input bar + call buttons and show a banner instead - you can
  // still read the existing messages.
  const accountStatus = isGroup ? null : otherUser?.status;
  const accountUnavailable = accountStatus === 'inactive' || accountStatus === 'deleted';
  const unavailableLabel = accountStatus === 'deleted'
    ? 'This account has been deleted'
    : 'This account has been deactivated';

  // Live presence for the other party (App.js owns `presenceMap`). Falls back
  // to the last-seen snapshot from GET /conversations. Both go null when the
  // other person has last-seen turned off (server suppresses the events and
  // nulls `with.last_seen`), so this shows neither "online" nor a timestamp.
  const presenceEntry = !isGroup && otherUser?.id != null ? presenceMap?.get(otherUser.id) : null;
  const isOnline = !!presenceEntry?.online;
  const lastSeenAt = presenceEntry?.lastSeen || otherUser?.last_seen || null;

  const headerSubtitle = isGroup || accountUnavailable
    ? null
    : (typing.state === 'typing'
      ? 'typing...'
      : isOnline
      ? 'online'
      : lastSeenAt
      ? `last seen ${new Date(lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '');

  const typingName = typing.name || (isGroup ? '' : otherUser?.name || '');

  const handlePrivateChatChange = (enabled) => setPrivateChatState(!!enabled);

  // --- Message search ---------------------------------------------------
  const runSearch = async (q, offset) => {
    const reqId = ++searchReqIdRef.current;
    try {
      const data = await searchMessages(token, conversationId, q, { limit: 20, offset });
      if (reqId !== searchReqIdRef.current) return; // a newer search superseded this
      setSearchError(null);
      setSearchResults((prev) => (offset === 0 ? data.results || [] : [...prev, ...(data.results || [])]));
      setSearchTotal(data.total || 0);
      setSearchHasMore(!!data.hasMore);
      if (offset === 0) setActiveResultIndex(-1);
    } catch (err) {
      if (reqId !== searchReqIdRef.current) return;
      setSearchResults([]);
      setSearchTotal(0);
      setSearchHasMore(false);
      setSearchError(err.message === 'Query too short' ? null : (err.message || 'Search failed'));
    } finally {
      if (reqId === searchReqIdRef.current) setSearchLoading(false);
    }
  };

  const handleSearchInput = (text) => {
    setSearchQuery(text);
    setResultsCollapsed(false);
    clearTimeout(searchDebounceRef.current);
    const q = text.trim();
    if (q.length < 2) {
      searchReqIdRef.current++; // invalidate any in-flight response
      setSearchResults([]);
      setSearchTotal(0);
      setSearchHasMore(false);
      setSearchError(null);
      setSearchLoading(false);
      setActiveResultIndex(-1);
      return;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(() => runSearch(q, 0), 300);
  };

  const loadMoreSearch = () => {
    if (searchLoading || !searchHasMore) return;
    runSearch(searchQuery.trim(), searchResults.length);
  };

  const enterSearchMode = () => {
    setSearchMode(true);
    setResultsCollapsed(false);
  };

  const exitSearchMode = () => {
    clearTimeout(searchDebounceRef.current);
    searchReqIdRef.current++;
    setSearchMode(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchTotal(0);
    setSearchHasMore(false);
    setSearchLoading(false);
    setSearchError(null);
    setResultsCollapsed(false);
    setActiveResultIndex(-1);
    Keyboard.dismiss();
  };

  const flashHighlight = (messageId) => {
    setHighlightedMessageId(messageId);
    highlightAnim.setValue(1);
    Animated.timing(highlightAnim, { toValue: 0, duration: 1500, useNativeDriver: false })
      .start(({ finished }) => { if (finished) setHighlightedMessageId(null); });
  };

  const scrollToMessageId = (messageId) => {
    // Index into the rendered list (messages + date separators), not the raw
    // messages array, so scrollToIndex lands on the right row.
    const index = listData.findIndex((m) => m.type !== 'dateSeparator' && m.id === messageId);
    if (index < 0) {
      Alert.alert('Message not loaded', 'This message is older than the loaded history. Scroll up in the chat to load more, then search again.');
      return false;
    }
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    } catch (e) {
      listRef.current?.scrollToOffset({ offset: Math.max(0, index * 72), animated: true });
    }
    return true;
  };

  // Deep link from Starred Messages (or any "open chat at this message"
  // caller): once this conversation's messages have loaded, jump to the
  // target once and flash-highlight it. If it's outside the loaded window
  // scrollToMessageId shows its own "older than loaded history" alert.
  useEffect(() => {
    if (!jumpToMessageId || messages.length === 0) return;
    if (lastJumpedIdRef.current === jumpToMessageId) return;
    lastJumpedIdRef.current = jumpToMessageId;
    const t = setTimeout(() => {
      if (scrollToMessageId(jumpToMessageId)) flashHighlight(jumpToMessageId);
    }, 400);
    return () => clearTimeout(t);
  }, [jumpToMessageId, messages.length]);

  const openResult = (index) => {
    if (index < 0 || index >= searchResults.length) return;
    const msg = searchResults[index];
    setActiveResultIndex(index);
    setResultsCollapsed(true);
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      if (scrollToMessageId(msg.id)) flashHighlight(msg.id);
    });
  };

  const stepResult = (dir) => {
    if (!searchResults.length) return;
    let next = activeResultIndex < 0 ? (dir > 0 ? 0 : searchResults.length - 1) : activeResultIndex + dir;
    if (next < 0) next = 0;
    if (next > searchResults.length - 1) {
      next = searchResults.length - 1;
      if (searchHasMore) loadMoreSearch();
    }
    openResult(next);
  };

  // Most recent image messages (newest first, max 3) for the profile modal's
  // "Media, Links & Docs" preview row.
  const recentImages = useMemo(
    () => messages
      .filter((m) => m.message_type === 'image' && !m.deleted_for_everyone && m.content)
      .slice(-3)
      .reverse()
      .map((m) => m.content),
    [messages]
  );

  // The FlatList data: messages with date-separator rows spliced in. `messages`
  // state stays a pure message array (socket handlers, recentImages, etc.);
  // separators live only in this derived list.
  const listData = useMemo(() => insertDateSeparators(messages), [messages]);

  const highlightBg = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,193,7,0)', 'rgba(255,193,7,0.45)'],
  });

  // Stable element so FlatList re-renders (not remounts) the indicator on
  // unrelated ChatScreen updates - otherwise the dot animation restarts on
  // every keystroke.
  const typingFooter = useMemo(
    () => (
      <TypingIndicator
        state={typing.state}
        isGroup={isGroup}
        name={typingName}
        avatarUri={isGroup ? null : (otherUser?.profilePicture || null)}
      />
    ),
    [typing.state, typingName, isGroup, otherUser?.profilePicture]
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: wallpaperColor || colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View
        style={styles.header}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        {searchMode ? (
          <>
            <TouchableOpacity onPress={exitSearchMode} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <TextInput
              style={styles.searchHeaderInput}
              placeholder="Search messages..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={handleSearchInput}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <TouchableOpacity onPress={exitSearchMode} style={styles.searchCancelBtn}>
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setProfileModalOpen(true)}
              disabled={isGroup ? false : !otherUser?.id}
              activeOpacity={0.6}
              style={styles.headerAvatarBtn}
            >
              {headerAvatarUri ? (
                <Image source={{ uri: headerAvatarUri }} style={styles.headerAvatarImg} />
              ) : (
                <View style={styles.headerAvatarFallback}>
                  <Text style={styles.headerAvatarInitial}>{headerInitial}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flex: 1 }}
              activeOpacity={0.6}
              disabled={isGroup ? false : !otherUser?.id}
              onPress={() => setProfileModalOpen(true)}
            >
              <View style={styles.headerTitleRow}>
                {privateChat && (
                  <Ionicons name="lock-closed" size={13} color={colors.textSecondary} style={styles.headerLock} />
                )}
                <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
              </View>
              {!!headerSubtitle && (
                <Text style={[styles.headerSubtitle, isOnline && styles.headerSubtitleOnline]}>
                  {headerSubtitle}
                </Text>
              )}
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={enterSearchMode} style={styles.headerIconBtn}>
                <Ionicons name="search" size={20} color={colors.accent} />
              </TouchableOpacity>
              {!isGroup && otherUser && onStartCall && !accountUnavailable && (
                <>
                  <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'audio')} style={styles.headerIconBtn}>
                    <Ionicons name="call-outline" size={22} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'video')} style={styles.headerIconBtn}>
                    <Ionicons name="videocam-outline" size={24} color={colors.accent} />
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity onPress={() => setHeaderMenuOpen(true)} style={styles.headerIconBtn}>
                <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <Modal visible={headerMenuOpen} transparent animationType="fade" onRequestClose={() => setHeaderMenuOpen(false)}>
        <TouchableOpacity style={styles.headerMenuOverlay} activeOpacity={1} onPress={() => setHeaderMenuOpen(false)}>
          <View style={[styles.headerMenuDropdown, { top: headerHeight || 96 }]}>
            <TouchableOpacity style={styles.headerMenuItem} onPress={handleExportChat}>
              <Ionicons name="share-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.headerMenuText}>Export Chat</Text>
            </TouchableOpacity>
            {!isGroup && otherUser?.id && (
              <TouchableOpacity
                style={styles.headerMenuItem}
                onPress={() => {
                  setHeaderMenuOpen(false);
                  Alert.alert(
                    `Block ${otherUser?.name || 'this user'}?`,
                    'They will not be able to send you messages or calls.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Block', style: 'destructive',
                        onPress: async () => {
                          try {
                            await blockUser(token, otherUser.id);
                            Alert.alert('Blocked', `${otherUser?.name || 'User'} has been blocked.`);
                          } catch (err) {
                            Alert.alert('Error', err.message || 'Could not block user.');
                          }
                        }
                      }
                    ]
                  );
                }}
              >
                <Ionicons name="ban-outline" size={18} color={colors.danger || '#ff4444'} />
                <Text style={[styles.headerMenuText, { color: colors.danger || '#ff4444' }]}>Block</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {!searchMode && !hidePinBar && pinnedMessages.length > 0 && (
        <TouchableOpacity
          style={styles.pinBar}
          activeOpacity={0.7}
          onPress={() => {
            if (pinnedMessages.length === 1) jumpToPinned(pinnedMessages[0].message_id);
            else setPinnedModalOpen(true);
          }}
        >
          <Ionicons name="pin" size={16} color={colors.accent} style={styles.pinBarIcon} />
          <View style={{ flex: 1 }}>
            {pinnedMessages.length === 1 ? (
              <>
                <Text style={styles.pinBarSender} numberOfLines={1}>
                  {pinnedMessages[0].sender_name || 'Pinned message'}
                </Text>
                <Text style={styles.pinBarText} numberOfLines={1}>{pinSnippet(pinnedMessages[0])}</Text>
              </>
            ) : (
              <Text style={styles.pinBarText} numberOfLines={1}>
                {pinnedMessages.length} pinned messages
              </Text>
            )}
          </View>
          {pinnedMessages.length > 1 && (
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          )}
          <TouchableOpacity
            onPress={() => setHidePinBar(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.pinBarClose}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </TouchableOpacity>
      )}

      {searchMode && resultsCollapsed && searchResults.length > 0 && (
        <View style={styles.searchNavBar}>
          <Text style={styles.searchNavText}>
            {activeResultIndex >= 0
              ? `${activeResultIndex + 1} of ${searchTotal}`
              : `${searchTotal} result${searchTotal === 1 ? '' : 's'}`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => stepResult(-1)} style={styles.searchNavBtn}>
              <Ionicons name="chevron-up" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => stepResult(1)} style={styles.searchNavBtn}>
              <Ionicons name="chevron-down" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setResultsCollapsed(false)} style={styles.searchNavBtn}>
              <Ionicons name="list" size={20} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={listData}
        keyExtractor={(item) => (item.type === 'dateSeparator' ? item.id : String(item.id))}
        extraData={highlightedMessageId}
        initialNumToRender={20}
        contentContainerStyle={{ padding: spacing.md }}
        onContentSizeChange={() => {
          // Don't yank the list to the bottom while the user is reviewing a
          // search hit further up.
          if (!highlightedMessageId) listRef.current?.scrollToEnd({ animated: true });
        }}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({
            offset: Math.max(0, (info.averageItemLength || 72) * info.index),
            animated: true,
          });
          setTimeout(() => {
            try {
              listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true });
            } catch (e) { /* give up quietly */ }
          }, 350);
        }}
        ListFooterComponent={typingFooter}
        renderItem={({ item }) => {
          if (item.type === 'dateSeparator') {
            return (
              <View style={styles.dateSepRow}>
                <View style={styles.dateSepLine} />
                <Text style={styles.dateSepText}>{item.date}</Text>
                <View style={styles.dateSepLine} />
              </View>
            );
          }

          if (item.message_type === 'system') {
            return (
              <View style={styles.systemRow}>
                <View style={styles.systemPill}>
                  <Ionicons name="lock-closed" size={12} color={colors.textSecondary} style={{ marginRight: 5 }} />
                  <Text style={styles.systemText}>{item.content}</Text>
                </View>
              </View>
            );
          }

          const isMine = item.user_id === currentUser.id;

          if (item.deleted_for_everyone) {
            return (
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="ban-outline" size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={styles.deletedText}>This message was deleted</Text>
                </View>
              </View>
            );
          }

          // View-once photo/video: a card, never the media inline. Not
          // swipeable, no long-press menu - it can only be viewed, and only once.
          if (item.view_once_duration != null) {
            const durLabel = item.view_once_duration === 0 ? 'View once' : `${item.view_once_duration}s`;
            const mediaLabel = item.message_type === 'video' ? 'Video' : 'Photo';
            const viewed = item.view_once_viewed === 1;
            if (isMine || viewed) {
              return (
                <View style={[styles.voCard, isMine ? styles.voCardMine : styles.voCardTheirs, styles.voCardSpent]}>
                  <Ionicons name="eye-off-outline" size={16} color={colors.textSecondary} style={styles.voCardIcon} />
                  <Text style={styles.voCardSpentText}>
                    {viewed && !isMine ? 'Opened' : `${mediaLabel} \u00B7 ${durLabel}`}
                  </Text>
                </View>
              );
            }
            return (
              <TouchableOpacity
                style={[styles.voCard, styles.voCardTheirs, styles.voCardOpen]}
                activeOpacity={0.8}
                onPress={() => openViewOnce(item)}
              >
                <Ionicons name="eye-outline" size={16} color={colors.accent} style={styles.voCardIcon} />
                <Text style={styles.voCardOpenText}>{`${mediaLabel} \u00B7 ${durLabel}`}</Text>
              </TouchableOpacity>
            );
          }

          const timeLabel = new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          // Flow meta row for image / voice messages. Text messages render the
          // time + ticks inline inside the message <Text> instead (Signal's
          // technique - see the message_type === 'text' branch below).
          const metaContent = (
            <>
              {item.edited === 1 && (
                <Text style={[styles.editedLabel, { color: isMine ? 'rgba(255,255,255,0.6)' : colors.textMuted }]}>edited</Text>
              )}
              <Text style={[styles.bubbleTime, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
                {timeLabel}
              </Text>
              {isMine && (
                <Ionicons
                  name={item.delivered ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={item.read ? '#8FD3FF' : 'rgba(255,255,255,0.7)'}
                />
              )}
            </>
          );

          const bubble = (
            <TouchableOpacity
              activeOpacity={0.85}
              onLongPress={() => openActionMenu(item)}
              style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}
            >
              {isMessageStarred(item) && (
                <Ionicons name="star-outline" size={11} color="#FFD700" style={styles.bubbleStarBadge} pointerEvents="none" />
              )}
              {isGroup && !isMine && <Text style={styles.senderName}>{item.username}</Text>}

              {item.reply_to_id && (
                <View style={[styles.replyPreview, isMine ? styles.replyPreviewMine : styles.replyPreviewTheirs]}>
                  <Text style={[styles.replyPreviewName, isMine ? styles.replyPreviewNameMine : styles.replyPreviewNameTheirs]}>
                    {item.reply_username}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {item.reply_deleted ? (
                      <>
                        <Ionicons name="ban-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textMuted} style={{ marginRight: 4 }} />
                        <Text
                          style={[styles.replyPreviewText, isMine ? styles.replyPreviewTextMine : styles.replyPreviewTextTheirs, { fontStyle: 'italic' }]}
                          numberOfLines={1}
                        >
                          This message was deleted
                        </Text>
                      </>
                    ) : (
                      <>
                        {item.reply_type === 'image' && <Ionicons name="camera-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} style={{ marginRight: 4 }} />}
                        {item.reply_type === 'video' && <Ionicons name="videocam-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} style={{ marginRight: 4 }} />}
                        {item.reply_type === 'audio' && <Ionicons name="mic-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} style={{ marginRight: 4 }} />}
                        {item.reply_type === 'file' && <Ionicons name="document-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} style={{ marginRight: 4 }} />}
                        {item.reply_type === 'location' && <Ionicons name="location-outline" size={12} color={isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary} style={{ marginRight: 4 }} />}
                        <Text
                          style={[styles.replyPreviewText, isMine ? styles.replyPreviewTextMine : styles.replyPreviewTextTheirs]}
                          numberOfLines={1}
                        >
                          {item.reply_type === 'image' ? 'Photo'
                            : item.reply_type === 'video' ? 'Video'
                            : item.reply_type === 'audio' ? 'Voice message'
                            : item.reply_type === 'location' ? 'Location'
                            : item.reply_type === 'file' ? (item.reply_content || 'Document')
                            : item.reply_content}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              )}

              {item.message_type === 'image' && (
                <TouchableOpacity onPress={() => setViewerImage(item.content)} onLongPress={() => openActionMenu(item)}>
                  <Image source={{ uri: item.content }} style={styles.messageImage} resizeMode="cover" />
                </TouchableOpacity>
              )}
              {item.message_type === 'image' && item.caption ? (
                <Text style={{ color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText, paddingHorizontal: 8, paddingBottom: 6, fontSize: 13 }}>
                  {item.caption}
                </Text>
              ) : null}
              {item.message_type === 'poll' && item.poll_options && (
                <View style={{ padding: 10, minWidth: 220 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Ionicons
                      name="bar-chart-outline"
                      size={15}
                      color={isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={{ color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText, fontWeight: '600', fontSize: 15, flexShrink: 1 }}>
                      {item.poll_question}
                    </Text>
                  </View>
                  {item.poll_options.map((opt, idx) => {
                    const totalVotes = item.poll_votes?.length || 0;
                    const optVotes = item.poll_votes?.filter((v) => v.option_index === idx).length || 0;
                    const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
                    const myVote = item.poll_votes?.find((v) => v.user_id === currentUser.id)?.option_index;
                    const voted = myVote != null;
                    const isMyChoice = myVote === idx;
                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => {
                          socketRef.current?.emit('poll:vote', { pollId: item.poll_id, optionIndex: idx }, (res) => {
                            if (!res?.ok) Alert.alert('Error', res?.error || 'Could not vote.');
                          });
                        }}
                        style={{
                          backgroundColor: isMyChoice ? colors.accent : (isMine ? 'rgba(255,255,255,0.15)' : colors.surface),
                          borderRadius: 8,
                          padding: 10,
                          marginBottom: 6,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text style={{ color: isMyChoice ? colors.textOnAccent : (isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText), flex: 1 }}>{opt}</Text>
                        {voted && <Text style={{ color: isMyChoice ? 'rgba(255,255,255,0.7)' : (isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary), fontSize: 12, marginLeft: 8 }}>{pct}%</Text>}
                        {isMyChoice && <Ionicons name="checkmark" size={16} color={colors.textOnAccent} style={{ marginLeft: 4 }} />}
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={{ color: isMine ? 'rgba(255,255,255,0.6)' : colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                    {item.poll_votes?.length || 0} vote{item.poll_votes?.length !== 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              {item.message_type === 'video' && <VideoBubble uri={item.content} />}
              {item.message_type === 'audio' && <AudioBubble uri={item.content} isMine={isMine} />}
              {item.message_type === 'file' && (
                <FileBubble
                  item={item}
                  isMine={isMine}
                  downloading={downloadingFileId === item.id}
                  onPress={() => openFileMessage(item)}
                />
              )}
              {item.message_type === 'location' && (
                <LocationBubble
                  item={item}
                  isMine={isMine}
                  onPress={openLocation}
                  onStopLiveShare={() => stopLiveLocation(item.id)}
                />
              )}
              {item.message_type === 'text' && (
                <Text style={[styles.bubbleText, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
                  {item.deleted_for_everyone ? '' : item.content}
                  {'  '}
                  <Text style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }}>
                    {item.edited === 1 ? 'edited  ' : ''}{timeLabel}
                  </Text>
                  {isMine && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: item.read ? '#8FD3FF' : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      {item.delivered || item.read ? '  \u2713\u2713' : '  \u2713'}
                    </Text>
                  )}
                </Text>
              )}

              {/* Image / voice / file / location keep the flow meta row below
                  the content. Text renders its time + ticks inline (above). */}
              {(item.message_type === 'image' || item.message_type === 'video' || item.message_type === 'audio'
                || item.message_type === 'file' || item.message_type === 'location') && (
                <View style={styles.metaRow}>
                  {metaContent}
                </View>
              )}
              <ReactionPills
                reactions={item.reactions}
                currentUserId={currentUser.id}
                onPress={(emoji) => handleToggleReaction(item.id, emoji)}
                onLongPress={(reaction) => Alert.alert('Reacted', `${reaction.emoji} x ${reaction.count}`)}
              />
            </TouchableOpacity>
          );

          const withHighlight = item.id === highlightedMessageId ? (
            <Animated.View style={[styles.highlightWrap, { backgroundColor: highlightBg }]}>
              {bubble}
            </Animated.View>
          ) : bubble;

          // Swipe-right-to-reply. Disabled in search mode, for deleted-for-
          // everyone / system messages (both already return above), and when
          // the other account is gone (no input bar to send a reply from).
          return (
            <SwipeableMessage
              enabled={!searchMode && !accountUnavailable}
              onTriggerReply={() => handleSwipeReply(item)}
            >
              {withHighlight}
            </SwipeableMessage>
          );
        }}
      />

      {searchMode && !resultsCollapsed && searchQuery.trim().length > 0 && (
        <View style={[styles.searchOverlay, { top: headerHeight || 96 }]}>
          {searchQuery.trim().length < 2 ? (
            <Text style={styles.searchStatus}>Keep typing to search</Text>
          ) : searchLoading && searchResults.length === 0 ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
          ) : searchError ? (
            <Text style={styles.searchStatus}>{searchError}</Text>
          ) : searchResults.length === 0 ? (
            <Text style={styles.searchStatus}>No messages found</Text>
          ) : (
            <>
              <View style={styles.searchResultsTop}>
                <Text style={styles.searchCountText}>
                  {searchTotal} result{searchTotal === 1 ? '' : 's'}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity onPress={() => stepResult(-1)} style={styles.searchNavBtn}>
                    <Ionicons name="chevron-up" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => stepResult(1)} style={styles.searchNavBtn}>
                    <Ionicons name="chevron-down" size={20} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>
              </View>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => `sr-${item.id}`}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onEndReached={loadMoreSearch}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                  searchLoading && searchResults.length > 0
                    ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
                    : null
                }
                renderItem={({ item, index }) => (
                  <TouchableOpacity style={styles.srRow} activeOpacity={0.6} onPress={() => openResult(index)}>
                    {item.profile_picture ? (
                      <Image source={{ uri: item.profile_picture }} style={styles.srAvatar} />
                    ) : (
                      <View style={styles.srAvatarFallback}>
                        <Text style={styles.srAvatarInitial}>
                          {(item.sender_name || '?').trim().charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <View style={styles.srTopLine}>
                        <Text style={styles.srName} numberOfLines={1}>{item.sender_name || 'Unknown'}</Text>
                        <Text style={styles.srDate}>
                          {new Date(item.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </Text>
                      </View>
                      {renderSnippet(item.content, searchQuery)}
                    </View>
                  </TouchableOpacity>
                )}
              />
            </>
          )}
        </View>
      )}

      {replyTo && !accountUnavailable && (
        <Animated.View
          style={[
            styles.replyBar,
            {
              opacity: replyBarAnim,
              transform: [{ translateY: replyBarAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          <Ionicons name="arrow-undo" size={16} color={colors.accent} style={{ marginRight: spacing.sm }} />
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.replyBarName, replyTo.user_id === currentUser.id && styles.replyBarNameOwn]}
              numberOfLines={1}
            >
              Reply to {replyTo.user_id === currentUser.id ? 'yourself' : (replyTo.username || 'Unknown')}
            </Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {replyTo.message_type === 'image'
                ? 'Photo'
                : replyTo.message_type === 'video'
                ? 'Video'
                : replyTo.message_type === 'audio'
                ? 'Voice message'
                : replyTo.message_type === 'location'
                ? 'Location'
                : replyTo.message_type === 'file'
                ? (replyTo.content || 'Document')
                : truncate(replyTo.content, 80)}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={colors.textMuted} style={{ paddingHorizontal: spacing.sm }} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {editingMessage && !accountUnavailable && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>Editing message</Text>
          </View>
          <TouchableOpacity onPress={cancelEdit}>
            <Ionicons name="close" size={18} color={colors.textMuted} style={{ paddingHorizontal: spacing.sm }} />
          </TouchableOpacity>
        </View>
      )}

      {/* Recorded video still uses the small staged bar (view-once pills +
          cancel) - the full-screen modal below is image-only, per the task
          that introduced it. Removing this for video too would leave staged
          video with no preview and no way to cancel it. */}
      {stagedVideo && !accountUnavailable && (
        <View style={styles.stagedBar}>
          <View style={[styles.stagedThumb, styles.stagedVideoThumb]}>
            <Ionicons name="videocam" size={16} color={colors.textMuted} />
          </View>
          {isGroup ? (
            <Text style={styles.stagedHint}>Video ready to send</Text>
          ) : (
            <View style={styles.voPillRow}>
              <Ionicons name="eye-outline" size={15} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
              {VIEW_ONCE_PILLS.map((p) => {
                const selected = viewOnceDuration === p.value;
                return (
                  <TouchableOpacity
                    key={p.value}
                    onPress={() => setViewOnceDuration(selected ? null : p.value)}
                    style={[styles.voPill, selected && styles.voPillSelected]}
                  >
                    <Text style={[styles.voPillText, selected && styles.voPillTextSelected]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TouchableOpacity onPress={clearStagedMedia} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Full-screen staged-image preview. Image-only (video keeps the small
          bar above); only ever appears for 1:1 chats since processAndSendImage
          sends group photos straight away without staging. */}
      <Modal
        visible={!!stagedImage}
        animationType="slide"
        transparent={false}
        onRequestClose={cancelStagedImage}
      >
        <View style={styles.stagedImageModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {stagedImage && (
            <Image
              source={{ uri: stagedImage }}
              style={styles.stagedImagePreview}
              resizeMode="contain"
              onLayout={(e) => setImageLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
              onLoad={(e) => setImageDimensions({ width: e.nativeEvent.source.width, height: e.nativeEvent.source.height })}
            />
          )}

          {cropMode && imageRect.width > 0 && (
            <View style={{ position: 'absolute', left: imageRect.left, top: imageRect.top, width: imageRect.width, height: imageRect.height }}>
              <CropOverlay
                layout={{ width: imageRect.width, height: imageRect.height }}
                initialCropRegion={cropRegionRef.current}
                onCropChange={(r) => { cropRegionRef.current = r; }}
              />
            </View>
          )}

          {!cropMode && (
            <>
              <View style={styles.stagedImageTopRight}>
                <TouchableOpacity
                  style={styles.stagedImageTopBtn}
                  onPress={() => Alert.alert('Coming soon', 'Drawing tools coming in next update.')}
                >
                  <Ionicons name="brush-outline" size={22} color="#fff" />
                  <Text style={styles.stagedImageTopBtnLabel}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.stagedImageTopBtn}
                  onPress={() => {
                    if (!imageDimensions.width) return;
                    cropRegionRef.current = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };
                    setCropMode(true);
                  }}
                >
                  <Ionicons name="crop-outline" size={22} color="#fff" />
                  <Text style={styles.stagedImageTopBtnLabel}>Crop</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.stagedImageBottom}>
                <View style={styles.stagedImageActionRow}>
                  <TouchableOpacity onPress={cancelStagedImage} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.stagedImageCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={sendStagedImage} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={styles.stagedImageOkText}>OK</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.stagedImageCaptionRow}>
                  <TextInput
                    style={styles.stagedImageCaptionInput}
                    placeholder="Add a caption..."
                    placeholderTextColor="rgba(255,255,255,0.55)"
                    value={stagedCaption}
                    onChangeText={setStagedCaption}
                  />
                  {!isGroup && (
                    <TouchableOpacity
                      style={styles.stagedImageViewOnceBtn}
                      onPress={() => setShowViewOnceOptions(true)}
                    >
                      <Ionicons
                        name="eye"
                        size={18}
                        color={viewOnceDuration !== null ? colors.accent : 'rgba(255,255,255,0.65)'}
                      />
                      {viewOnceDuration !== null && (
                        <Ionicons name="checkmark" size={12} color={colors.accent} style={styles.stagedImageViewOnceCheck} />
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.stagedImageSendBtn} onPress={sendStagedImage}>
                    <Ionicons name="send" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {cropMode && (
            <View style={styles.cropActionBar}>
              <TouchableOpacity onPress={cancelCrop} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} disabled={applyingCrop}>
                <Text style={styles.stagedImageCancelText}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.cropActionTitle}>Crop</Text>
              {applyingCrop ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <TouchableOpacity onPress={applyCrop} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.stagedImageOkText}>Apply</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* View-once timer bottom sheet - same VIEW_ONCE_PILLS rendering and
              the same shared viewOnceDuration state as the small stagedBar
              above, just opened from this button instead of shown inline. */}
          <Modal
            visible={showViewOnceOptions}
            transparent
            animationType="fade"
            onRequestClose={() => setShowViewOnceOptions(false)}
          >
            <TouchableOpacity
              style={styles.viewOnceSheetOverlay}
              activeOpacity={1}
              onPress={() => setShowViewOnceOptions(false)}
            >
              <View style={styles.viewOnceSheet}>
                <Text style={styles.viewOnceSheetTitle}>View once</Text>
                <View style={styles.voPillRow}>
                  {VIEW_ONCE_PILLS.map((p) => {
                    const selected = viewOnceDuration === p.value;
                    return (
                      <TouchableOpacity
                        key={p.value}
                        onPress={() => {
                          setViewOnceDuration(selected ? null : p.value);
                          setShowViewOnceOptions(false);
                        }}
                        style={[styles.voPill, selected && styles.voPillSelected]}
                      >
                        <Text style={[styles.voPillText, selected && styles.voPillTextSelected]}>{p.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        </KeyboardAvoidingView>
        </View>
      </Modal>

      {!accountUnavailable && (
      <View style={[styles.inputRow, { paddingBottom: insets.bottom || 8 }]}>
        <TouchableOpacity
          style={styles.emojiButton}
          onPress={() => {
            const next = !showEmojiBar;
            setShowEmojiBar(next);
            if (next) Keyboard.dismiss();
          }}
        >
          <Ionicons name="happy-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={handleTypingInput}
          onFocus={() => setShowEmojiBar(false)}
          multiline
        />

        <TouchableOpacity style={styles.attachButton} onPress={takePhoto} disabled={sendingCameraImage}>
          {sendingCameraImage ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="camera-outline" size={23} color={colors.textSecondary} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.attachButton}
          onPress={() => setAttachMenuOpen(true)}
          disabled={sendingImage || sendingFile || sendingVideo}
        >
          {(sendingImage || sendingFile || sendingVideo)
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Ionicons name="attach-outline" size={23} color={colors.textSecondary} />}
        </TouchableOpacity>

        {editingMessage ? (
          <TouchableOpacity style={styles.sendButton} onPress={submitEdit}>
            <Text style={styles.sendButtonText}>Save</Text>
          </TouchableOpacity>
        ) : stagedVideo ? (
          <View>
            <TouchableOpacity style={styles.sendButtonRound} onPress={sendStagedMedia}>
              <Ionicons name="send" size={18} color={colors.textOnAccent} />
            </TouchableOpacity>
            {viewOnceDuration !== null && (
              <View style={styles.voSendBadge}>
                <Ionicons name="eye-outline" size={10} color={colors.textOnAccent} />
              </View>
            )}
          </View>
        ) : input.trim().length === 0 ? (
          <TouchableOpacity
            style={styles.micButton}
            onPressIn={startRecording}
            onPressOut={stopRecordingAndSend}
          >
            <Animated.View style={[
              styles.micPulse,
              recorderState.isRecording && { transform: [{ scale: pulseAnim }], backgroundColor: colors.recordingPulse }
            ]}>
              <Ionicons name={recorderState.isRecording ? 'stop' : 'mic'} size={20} color={colors.textOnAccent} />
            </Animated.View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.sendButtonRound} onPress={() => sendMessage()}>
            <Ionicons name="send" size={18} color={colors.textOnAccent} />
          </TouchableOpacity>
        )}
      </View>
      )}

      <Modal visible={attachMenuOpen} transparent animationType="fade" onRequestClose={() => setAttachMenuOpen(false)}>
        <TouchableOpacity style={styles.headerMenuOverlay} activeOpacity={1} onPress={() => setAttachMenuOpen(false)}>
          <View style={styles.attachMenuDropdown}>
            <TouchableOpacity
              style={styles.headerMenuItem}
              onPress={() => { setAttachMenuOpen(false); pickImage(); }}
            >
              <Ionicons name="image-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.headerMenuText}>Photo & Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerMenuItem} onPress={recordVideo}>
              <Ionicons name="videocam-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.headerMenuText}>Record Video</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerMenuItem} onPress={pickDocument}>
              <Ionicons name="document-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.headerMenuText}>Document</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerMenuItem} onPress={openLocationPicker}>
              <Ionicons name="location-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.headerMenuText}>Location</Text>
            </TouchableOpacity>
            {isGroup && (
              <TouchableOpacity
                style={styles.headerMenuItem}
                onPress={() => { setAttachMenuOpen(false); setShowPollCreator(true); }}
              >
                <Ionicons name="bar-chart-outline" size={18} color={colors.textPrimary} />
                <Text style={styles.headerMenuText}>Poll</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showPollCreator} animationType="slide" transparent={false} onRequestClose={cancelPollCreator}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: colors.background }}
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 50 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
              <TouchableOpacity onPress={cancelPollCreator}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: colors.textPrimary }}>New Poll</Text>
              <TouchableOpacity onPress={submitPoll}>
                <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '600' }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Up to 10 options + the question field can run past one screen -
              scrollable so the lower options and "Add option" stay reachable
              (the given design had no ScrollView and would clip on a normal
              phone once a handful of options are added). */}
          <ScrollView
            style={{ flex: 1, paddingHorizontal: 16 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            {/* Question */}
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>QUESTION</Text>
            <TextInput
              style={{ backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 20 }}
              placeholder="Ask a question..."
              placeholderTextColor={colors.textSecondary}
              value={pollQuestion}
              onChangeText={setPollQuestion}
              maxLength={200}
            />

            {/* Options */}
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 6 }}>OPTIONS</Text>
            {pollOptions.map((opt, idx) => (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <TextInput
                  style={{ flex: 1, backgroundColor: colors.surface, color: colors.textPrimary, borderRadius: 10, padding: 12, fontSize: 15 }}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={colors.textSecondary}
                  value={opt}
                  onChangeText={(val) => {
                    const next = [...pollOptions];
                    next[idx] = val;
                    setPollOptions(next);
                  }}
                  maxLength={100}
                />
                {pollOptions.length > 2 && (
                  <TouchableOpacity onPress={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))} style={{ marginLeft: 8 }}>
                    <Ionicons name="remove-circle-outline" size={22} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {pollOptions.length < 10 && (
              <TouchableOpacity onPress={() => setPollOptions([...pollOptions, ''])} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                <Text style={{ color: colors.accent, marginLeft: 6, fontSize: 15 }}>Add option</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {sendingFile && (
        <View style={styles.fileUploadBanner}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.fileUploadText}>
            Sending file... {Math.round(fileUploadProgress * 100)}%
          </Text>
        </View>
      )}

      {!accountUnavailable && (
      <MediaPickerSheet
        visible={showEmojiBar}
        token={token}
        serverUrl={SERVER_URL}
        onInsertEmoji={insertEmoji}
        onPickMedia={handlePickMedia}
        onRequestClose={() => setShowEmojiBar(false)}
      />
      )}

      {accountUnavailable && (
        <View style={styles.unavailableBanner}>
          <Ionicons name="ban-outline" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
          <Text style={styles.unavailableText}>{unavailableLabel}</Text>
        </View>
      )}

      {recorderState.isRecording && !accountUnavailable && (
        <View style={styles.recordingBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.View style={[styles.recDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.recordingText}>Recording {formatDuration(recorderState.durationMillis)} - release to send</Text>
          </View>
          <TouchableOpacity onPress={cancelRecording}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={!!actionMenuFor} transparent animationType="fade" onRequestClose={closeActionMenu}>
        <TouchableOpacity style={styles.actionOverlay} activeOpacity={1} onPress={closeActionMenu}>
          <View style={styles.actionMenu}>
            {!accountUnavailable && (
              <TouchableOpacity style={styles.actionItem} onPress={handleReply}>
                <Text style={styles.actionText}>Reply</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={openReactionPicker}>
              <Text style={styles.actionText}>React</Text>
            </TouchableOpacity>
            {actionMenuFor && (
              <TouchableOpacity style={styles.actionItem} onPress={handleToggleStar}>
                <View style={styles.actionItemRow}>
                  <Ionicons
                    name={isMessageStarred(actionMenuFor) ? 'star' : 'star-outline'}
                    size={17}
                    color={isMessageStarred(actionMenuFor) ? '#FFD700' : colors.textPrimary}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.actionText}>{isMessageStarred(actionMenuFor) ? 'Unstar' : 'Star'}</Text>
                </View>
              </TouchableOpacity>
            )}
            {actionMenuFor && (
              <TouchableOpacity style={styles.actionItem} onPress={handleTogglePin}>
                <View style={styles.actionItemRow}>
                  <Ionicons
                    name={isMessagePinned(actionMenuFor) ? 'pin' : 'pin-outline'}
                    size={17}
                    color={isMessagePinned(actionMenuFor) ? colors.accent : colors.textPrimary}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.actionText}>{isMessagePinned(actionMenuFor) ? 'Unpin' : 'Pin'}</Text>
                </View>
              </TouchableOpacity>
            )}
            {actionMenuFor?.message_type === 'image' && (
              <TouchableOpacity style={styles.actionItem} onPress={() => { const msg = actionMenuFor; closeActionMenu(); saveImage(msg.content); }}>
                <Text style={styles.actionText}>Save to Gallery</Text>
              </TouchableOpacity>
            )}
            {actionMenuFor?.message_type === 'text' && (
              <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
                <Text style={styles.actionText}>Copy</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={handleForward}>
              <Text style={styles.actionText}>Forward</Text>
            </TouchableOpacity>
            {actionMenuFor?.user_id === currentUser.id && actionMenuFor?.message_type === 'text' && !accountUnavailable && (
              <TouchableOpacity style={styles.actionItem} onPress={handleEdit}>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={confirmDelete}>
              <Text style={[styles.actionText, { color: colors.danger }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <ReactionPicker
        visible={!!reactionPickerFor}
        onSelect={(emoji) => handleToggleReaction(reactionPickerFor.id, emoji)}
        onClose={() => setReactionPickerFor(null)}
      />

      <Modal visible={!!forwardPickerFor} transparent animationType="slide" onRequestClose={() => setForwardPickerFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.forwardBox}>
            <Text style={styles.modalTitle}>Forward to...</Text>
            <FlatList
              data={forwardTargets}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const title = item.is_group ? item.name : item.with?.name;
                return (
                  <TouchableOpacity style={styles.forwardRow} onPress={() => doForwardTo(item.id)}>
                    <Text style={styles.forwardRowText}>{title || 'Chat'}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>No other chats to forward to</Text>}
            />
            <TouchableOpacity onPress={() => setForwardPickerFor(null)} style={styles.modalCancel}>
              <Text>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ImageViewerModal
        visible={!!viewerImage}
        uri={viewerImage}
        saving={savingViewerImage}
        onClose={() => setViewerImage(null)}
        onSave={async () => {
          setSavingViewerImage(true);
          await saveImage(viewerImage);
          setSavingViewerImage(false);
        }}
      />

      {viewOnceViewing && (
        <ViewOnceViewer
          key={viewOnceViewing.id}
          token={token}
          conversationId={conversationId}
          messageId={viewOnceViewing.id}
          uri={viewOnceViewing.content}
          duration={viewOnceViewing.view_once_duration}
          messageType={viewOnceViewing.message_type}
          onViewed={() => {
            const vid = viewOnceViewing.id;
            setMessages((prev) => prev.map((m) => (
              m.id === vid ? { ...m, view_once_viewed: 1, content: null } : m
            )));
          }}
          onClose={() => setViewOnceViewing(null)}
        />
      )}

      <UserProfileModal
        visible={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        token={token}
        currentUser={currentUser}
        isGroup={isGroup}
        groupName={groupName}
        conversationId={conversationId}
        otherUser={otherUser}
        onStartCall={onStartCall}
        onlineUsers={presenceMap}
        recentImages={recentImages}
        privateChat={privateChat}
        onPrivateChatChange={handlePrivateChatChange}
        muted={contactMuted}
        onMuteChange={handleMuteChange}
        onOpenNotifications={() => { setProfileModalOpen(false); setNotifSettingsOpen(true); }}
        onOpenSharedMedia={() => { setProfileModalOpen(false); setSharedMediaOpen(true); }}
        onLeaveGroup={onBack}
      />

      {notifSettingsOpen && !isGroup && !!otherUser?.id && (
        <View style={styles.notifSettingsOverlay}>
          <ContactNotificationSettings
            userId={otherUser.id}
            userName={otherUser.name}
            muted={contactMuted}
            onMuteChange={handleMuteChange}
            onBack={() => { setNotifSettingsOpen(false); setProfileModalOpen(true); }}
          />
        </View>
      )}

      {sharedMediaOpen && (
        <View style={styles.notifSettingsOverlay}>
          <SharedMediaScreen
            token={token}
            conversationId={conversationId}
            otherUser={otherUser}
            isGroup={isGroup}
            groupName={groupName}
            onSaveImage={saveImage}
            onBack={() => { setSharedMediaOpen(false); setProfileModalOpen(true); }}
          />
        </View>
      )}

      {fileToConfirm && (
        <View style={styles.notifSettingsOverlay}>
          <FilePreviewScreen
            file={fileToConfirm}
            sending={sendingFile}
            onSend={confirmSendFile}
            onCancel={cancelFileConfirm}
          />
        </View>
      )}

      {showLocationPicker && (
        <View style={styles.notifSettingsOverlay}>
          <LocationPickerScreen
            onSendStatic={handleSendStaticLocation}
            onStartLive={startLiveLocation}
            onCancel={() => setShowLocationPicker(false)}
          />
        </View>
      )}

      <PinnedMessagesModal
        visible={pinnedModalOpen}
        pins={pinnedMessages}
        onClose={() => setPinnedModalOpen(false)}
        onJumpTo={jumpToPinned}
        onUnpin={handleUnpinFromModal}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  backArrow: { color: colors.textPrimary, fontSize: 22 },
  headerAvatarBtn: { marginRight: spacing.sm },
  headerAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarInitial: { color: colors.textOnAccent, fontSize: 16, fontWeight: '700' },

  searchHeaderInput: {
    flex: 1, marginHorizontal: spacing.sm, fontSize: 16, color: colors.textPrimary,
    paddingVertical: 4,
  },
  searchCancelBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  searchCancelText: { color: colors.accent, fontSize: 15, fontWeight: '600' },

  searchNavBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    zIndex: 15, elevation: 15,
  },
  searchNavText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  searchNavBtn: { padding: 6, marginLeft: 2 },

  // Pinned-messages bar: below the header, above the message list.
  pinBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  pinBarIcon: { marginRight: spacing.sm },
  pinBarSender: { fontSize: 12, fontWeight: '700', color: colors.accent },
  pinBarText: { fontSize: 13, color: colors.textSecondary },
  pinBarClose: { marginLeft: spacing.sm, padding: 2 },

  searchOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background, zIndex: 30, elevation: 30,
  },
  searchStatus: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: 14 },
  searchResultsTop: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  searchCountText: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  srRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  srAvatar: { width: 36, height: 36, borderRadius: 18 },
  srAvatarFallback: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  srAvatarInitial: { color: colors.textOnAccent, fontSize: 15, fontWeight: '700' },
  srTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  srName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  srDate: { fontSize: 11, color: colors.textMuted },
  srSnippet: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  srSnippetMatch: { fontWeight: '700', color: colors.textPrimary },

  highlightWrap: { borderRadius: radii.md },

  // Swipe-to-reply: the icon sits absolutely at the row's left edge so it can
  // never push the bubble's layout as it fades/scales in.
  swipeRow: { position: 'relative' },
  swipeReplyIcon: {
    position: 'absolute', left: 8, top: 0, bottom: 0, width: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  headerLock: { marginRight: 4 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600', flexShrink: 1 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  headerSubtitleOnline: { color: '#4CAF50' },
  headerIconBtn: { marginLeft: spacing.md, padding: 2 },
  headerIcon: { fontSize: 20 },
  notifSettingsOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background, zIndex: 100, elevation: 100,
  },

  systemRow: { alignItems: 'center', marginVertical: spacing.sm },
  systemPill: {
    flexDirection: 'row', alignItems: 'center', maxWidth: '88%',
    backgroundColor: colors.surface, borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  systemText: { fontSize: 12, color: colors.textSecondary, textAlign: 'center' },

  bubble: { maxWidth: '78%', borderRadius: radii.bubble, padding: spacing.md, marginBottom: spacing.sm, position: 'relative' },
  bubbleMine: {
    backgroundColor: colors.bubbleOutgoing, alignSelf: 'flex-end',
    borderBottomRightRadius: radii.bubbleTail
  },
  bubbleTheirs: {
    backgroundColor: colors.bubbleIncoming, alignSelf: 'flex-start',
    borderBottomLeftRadius: radii.bubbleTail
  },
  senderName: { fontSize: 12, fontWeight: '700', color: colors.accent, marginBottom: 2 },
  bubbleText: { ...typography.bubbleText },
  deletedText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  messageImage: { width: 200, height: 200, borderRadius: radii.sm },
  saveHint: { fontSize: 10, marginTop: 2, textAlign: 'center' },

  // View-once photo card (replaces the inline image for view-once messages).
  voCard: {
    maxWidth: '78%', flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    borderRadius: radii.bubble, marginBottom: spacing.sm, borderWidth: 1,
  },
  voCardMine: { alignSelf: 'flex-end', borderBottomRightRadius: radii.bubbleTail },
  voCardTheirs: { alignSelf: 'flex-start', borderBottomLeftRadius: radii.bubbleTail },
  voCardOpen: { backgroundColor: colors.surface, borderColor: colors.accent },
  voCardSpent: { backgroundColor: colors.surface, borderColor: colors.border },
  voCardIcon: { marginRight: spacing.sm },
  voCardOpenText: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  voCardSpentText: { fontSize: 14, color: colors.textSecondary },

  // Staged-photo bar above the input row + its view-once timer pills.
  stagedBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  stagedThumb: { width: 36, height: 36, borderRadius: radii.sm, marginRight: spacing.md, backgroundColor: colors.border },
  stagedVideoThumb: { alignItems: 'center', justifyContent: 'center' },
  stagedHint: { flex: 1, fontSize: 13, color: colors.textMuted },
  voPillRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  voPill: {
    minWidth: 30, height: 26, borderRadius: 13, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm, paddingHorizontal: 6,
  },
  voPillSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  voPillText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  voPillTextSelected: { color: colors.textOnAccent },
  voSendBadge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.textPrimary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.background,
  },

  // Full-screen staged-image preview modal.
  stagedImageModal: { flex: 1, backgroundColor: '#000' },
  stagedImagePreview: { flex: 1, width: '100%' },
  stagedImageTopRight: {
    position: 'absolute', top: 48, right: spacing.lg, alignItems: 'center',
  },
  stagedImageTopBtn: { alignItems: 'center', marginBottom: spacing.lg },
  stagedImageTopBtnLabel: { color: '#fff', fontSize: 11, marginTop: 4 },
  stagedImageBottom: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  stagedImageActionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  stagedImageCancelText: { color: '#fff', fontSize: 16 },
  stagedImageOkText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  cropActionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  cropActionTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  stagedImageCaptionRow: { flexDirection: 'row', alignItems: 'center' },
  stagedImageCaptionInput: {
    flex: 1, color: '#fff', fontSize: 15, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radii.pill, marginRight: spacing.sm,
  },
  stagedImageViewOnceBtn: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, marginRight: spacing.sm,
  },
  stagedImageViewOnceCheck: { marginLeft: 2 },
  stagedImageSendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  // View-once timer bottom sheet, opened from the staged-image modal.
  viewOnceSheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  viewOnceSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl,
  },
  viewOnceSheetTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },

  audioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, minWidth: 140 },
  audioIcon: { marginRight: spacing.sm },
  audioLabel: { fontSize: 14 },
  // Reply quote rendered inside a message bubble. The colours switch on the
  // bubble type so quoted text is never grey/light on the blue outgoing
  // bubble: `*Mine` = on the accent (blue) sent bubble, `*Theirs` = on the
  // grey/white received bubble.
  replyPreview: {
    borderLeftWidth: 3,
    paddingLeft: spacing.sm, paddingVertical: 4, marginBottom: spacing.sm, borderRadius: 4
  },
  replyPreviewMine: { borderLeftColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.15)' },
  replyPreviewTheirs: { borderLeftColor: colors.accent, backgroundColor: 'rgba(0,0,0,0.06)' },
  replyPreviewName: { fontSize: 12, fontWeight: '700' },
  replyPreviewNameMine: { color: '#FFFFFF' },
  replyPreviewNameTheirs: { color: colors.accent },
  replyPreviewText: { fontSize: 12 },
  replyPreviewTextMine: { color: 'rgba(255,255,255,0.85)' },
  replyPreviewTextTheirs: { color: colors.textSecondary },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  // Tiny gold star at the bubble's bottom-left, shown only when the current
  // user has starred this message.
  bubbleStarBadge: { position: 'absolute', left: 5, bottom: 3 },

  // Date separator row between messages of different calendar days.
  dateSepRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.md },
  dateSepLine: { flex: 1, height: 1, backgroundColor: colors.divider },
  dateSepText: {
    fontSize: 12, color: colors.textMuted, fontWeight: '600',
    marginHorizontal: spacing.md,
  },
  editedLabel: { fontSize: 10, marginRight: 4, fontStyle: 'italic' },
  bubbleTime: { fontSize: 10, marginRight: 4 },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border
  },
  replyBarName: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  replyBarNameOwn: { color: colors.accent },
  replyBarText: { fontSize: 12, color: colors.textSecondary },

  inputRow: {
    flexDirection: 'row', padding: spacing.sm, backgroundColor: colors.background,
    alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.border
  },
  attachButton: { padding: spacing.sm, marginRight: 2, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  emojiButton: { padding: spacing.sm, marginRight: 2, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginRight: spacing.sm,
    maxHeight: 100, color: colors.textPrimary
  },
  sendButton: {
    backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, justifyContent: 'center'
  },
  sendButtonText: { color: colors.textOnAccent, fontWeight: '600' },
  sendButtonRound: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  micButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  micPulse: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  micIcon: { fontSize: 18 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginRight: 6 },
  recordingBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFF6E5', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm
  },
  recordingText: { color: '#8A6100', fontSize: 13 },
  cancelText: { color: colors.danger, fontSize: 13, fontWeight: '600' },

  unavailableBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border
  },
  unavailableText: { color: colors.textMuted, fontSize: 14 },

  actionOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
  actionMenu: { backgroundColor: colors.background, borderRadius: radii.md, width: 220, paddingVertical: spacing.sm, ...shadow.md },
  actionItem: { paddingVertical: 14, paddingHorizontal: spacing.xl },

  headerMenuOverlay: { flex: 1, backgroundColor: 'transparent' },
  headerMenuDropdown: {
    position: 'absolute', right: spacing.lg, minWidth: 200,
    backgroundColor: colors.background, borderRadius: radii.md,
    paddingVertical: spacing.xs, ...shadow.md,
  },
  headerMenuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.lg },
  headerMenuText: { fontSize: 15, color: colors.textPrimary, marginLeft: spacing.md },

  // Attach menu (Photo & Video / Document / Location), opened from the
  // paperclip button - bottom-anchored, unlike headerMenuDropdown's
  // top-anchored position under the header.
  attachMenuDropdown: {
    position: 'absolute', bottom: 72, right: spacing.md, minWidth: 190,
    backgroundColor: colors.background, borderRadius: radii.md,
    paddingVertical: spacing.xs, ...shadow.md,
  },
  fileUploadBanner: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg, backgroundColor: colors.surface,
  },
  fileUploadText: { fontSize: 13, color: colors.textSecondary, marginLeft: spacing.sm },

  // File / location message bubble content.
  fileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, minWidth: 180 },
  fileIconWrap: {
    width: 44, height: 44, borderRadius: radii.md,
    justifyContent: 'center', alignItems: 'center',
  },
  fileIconWrapMine: { backgroundColor: 'rgba(255,255,255,0.2)' },
  fileIconWrapTheirs: { backgroundColor: colors.surface },
  fileTextCol: { flex: 1, marginLeft: spacing.sm, marginRight: spacing.xs },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 12, marginTop: 2 },
  stopLiveShareRow: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  stopLiveShareText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  actionItemRow: { flexDirection: 'row', alignItems: 'center' },
  actionText: { fontSize: 16, color: colors.textPrimary },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  forwardBox: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md, maxHeight: '60%' },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.md, color: colors.textPrimary },
  forwardRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  forwardRowText: { fontSize: 15, color: colors.textPrimary },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 20 },
  modalCancel: { padding: spacing.md, alignItems: 'center', marginTop: spacing.sm }
});
