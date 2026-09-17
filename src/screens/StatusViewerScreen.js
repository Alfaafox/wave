// src/screens/StatusViewerScreen.js
//
// Full-screen status viewer, Instagram/WhatsApp pattern: per-status
// progress bars that auto-advance, tap-left/right to navigate, long-press to
// pause, a reply bar (or, for your own status, a view-count row that opens a
// viewer list). Rendered by App.js as a plain full-screen overlay (not a
// Modal) - same reasoning CallScreen.js documents for its own screen: this
// needs to sit above the tab bar with no native Dialog-window quirks.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, TextInput,
  Animated, Easing, Pressable, Platform, StatusBar, Alert,
  KeyboardAvoidingView, Modal, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { viewStatus, deleteStatus } from '../utils/api';
import { colors, spacing, radii } from '../theme';

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 54;
const TEXT_DURATION_MS = 5000;
const MEDIA_DURATION_MS = 7000;
const LONG_PRESS_DELAY = 220;

function durationFor(status) {
  return status?.contentType === 'text' ? TEXT_DURATION_MS : MEDIA_DURATION_MS;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusVideo({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.mediaFill}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

export default function StatusViewerScreen({ statusGroup, currentUser, token, onClose, onStartChat }) {
  const groupUser = statusGroup?.user || {};
  const isOwn = groupUser.id === currentUser?.id;

  // Local copy so deleting a status can update what's rendered without
  // mutating the statusGroup prop App.js handed down (progressAnims below
  // stays sized to the ORIGINAL statuses.length - harmless if it later
  // shrinks, since deleted indices just go unused, never out of bounds).
  const [statuses, setStatuses] = useState(statusGroup?.statuses || []);

  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [viewersSheetOpen, setViewersSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sticker overlay coordinate space (Session 23) - the same normalized 0-1
  // x/y StatusCreatorScreen's canvas uses, so a sticker's saved position
  // maps back onto this exact rect. The media fills this box edge to edge
  // regardless of which status is active, so one measurement is enough -
  // no need to re-measure per status.
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const handleMediaLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvasSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const current = statuses[activeIndex];

  const progressAnims = useRef(statuses.map(() => new Animated.Value(0))).current;
  const runningAnimRef = useRef(null);
  const pausedValueRef = useRef(0);
  const longPressActiveRef = useRef(false);

  const goToIndex = useCallback((idx) => {
    if (idx < 0) return; // no-op past the first status
    if (idx >= statuses.length) { onClose(); return; }
    setActiveIndex(idx);
  }, [statuses.length, onClose]);

  const startProgress = useCallback((fromValue = 0) => {
    const status = statuses[activeIndex];
    if (!status) return;
    const duration = durationFor(status);
    const anim = progressAnims[activeIndex];
    anim.setValue(fromValue);
    const remaining = duration * (1 - fromValue);
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: remaining,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    runningAnimRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) goToIndex(activeIndex + 1);
    });
  }, [activeIndex, statuses, progressAnims, goToIndex]);

  // Mark bars before activeIndex as full, after as empty, and (re)start the
  // current one from 0 - runs whenever the active status changes, and also
  // when `statuses` itself changes (deleting a status can swap in new
  // content at the same numeric index, which activeIndex alone wouldn't
  // detect).
  useEffect(() => {
    progressAnims.forEach((anim, idx) => {
      if (idx < activeIndex) anim.setValue(1);
      else if (idx > activeIndex) anim.setValue(0);
    });
    setPaused(false);
    longPressActiveRef.current = false;
    startProgress(0);
    return () => { runningAnimRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, statuses]);

  // View recording - fires once per status as it becomes active. Harmless
  // (server no-ops) when it's our own status.
  useEffect(() => {
    if (!current) return;
    viewStatus(token, current.id).catch(() => {});
  }, [current?.id, token]);

  const pause = () => {
    longPressActiveRef.current = true;
    runningAnimRef.current?.stop();
    progressAnims[activeIndex].stopAnimation((value) => { pausedValueRef.current = value; });
    setPaused(true);
  };

  const resume = () => {
    setPaused(false);
    startProgress(pausedValueRef.current);
  };

  const handlePressOut = (side) => {
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false;
      resume();
      return;
    }
    if (side === 'left') goToIndex(activeIndex - 1);
    else goToIndex(activeIndex + 1);
  };

  const handleSendReply = () => {
    const text = replyText.trim();
    if (!text) return;
    setReplyText('');
    onStartChat(groupUser, text);
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete this update?',
      'This will remove it for everyone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (!current) return;
            setDeleting(true);
            try {
              await deleteStatus(token, current.id);
              if (statuses.length <= 1) { onClose(); return; }
              // Remove locally and keep viewing the rest of the group.
              const next = statuses.filter((_, i) => i !== activeIndex);
              const nextIndex = Math.min(activeIndex, next.length - 1);
              setStatuses(next);
              goToIndex(nextIndex);
            } catch (err) {
              Alert.alert('Could not delete', err.message || 'Try again.');
            } finally {
              setDeleting(false);
            }
          }
        }
      ]
    );
  };

  if (!current) return null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Content */}
      <View style={styles.mediaFill} onLayout={handleMediaLayout}>
        {current.contentType === 'text' ? (
          <View style={[styles.mediaFill, styles.textFill, { backgroundColor: current.bgColor || colors.accent }]}>
            <Text style={styles.textContent}>{current.content}</Text>
          </View>
        ) : current.contentType === 'video' ? (
          <StatusVideo uri={current.content} />
        ) : (
          <Image source={{ uri: current.content }} style={styles.mediaFill} resizeMode="contain" />
        )}

        {/* Render saved sticker positions - the composer's own normalized
            0-1 x/y multiplied back against this box's measured size, same
            coordinate system StatusCreatorScreen's canvas uses. Statuses
            posted before this feature shipped have no sticker_positions
            (null) and simply render no stickers - they expire within 24h
            regardless, so there's no long-lived data to migrate. */}
        {canvasSize.width > 0 && current.stickerPositions?.map((s) => (
          <View
            key={s.id}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: s.x * canvasSize.width - 60, // 60 = approx half sticker width
              top: s.y * canvasSize.height - 20, // 20 = approx half sticker height
              transform: [
                { scale: s.scale || 1 },
                { rotate: `${s.rotation || 0}rad` },
              ],
              zIndex: 10,
            }}
          >
            {s.type === 'location' && (
              <View style={styles.stickerPill}>
                <Ionicons name="location" size={12} color={colors.textPrimary} />
                <Text style={styles.stickerPillText} numberOfLines={1}>{s.content}</Text>
              </View>
            )}
            {s.type === 'time' && (
              <View style={styles.stickerPill}>
                <Ionicons name="time-outline" size={12} color={colors.textPrimary} />
                <Text style={styles.stickerPillText}>{s.content}</Text>
              </View>
            )}
            {s.type === 'poll' && s.content?.question && (
              <View style={styles.stickerPollCard}>
                <Text style={styles.stickerPollQuestion}>{s.content.question}</Text>
                {s.content.options?.map((opt, idx) => (
                  <View key={idx} style={styles.stickerPollOption}>
                    <Text style={styles.stickerPollOptionText}>{opt}</Text>
                  </View>
                ))}
              </View>
            )}
            {s.type === 'text' && s.content?.trim() && (
              <Text style={styles.stickerTextOverlay}>{s.content}</Text>
            )}
          </View>
        ))}
      </View>

      {/* Tap zones for prev/next + long-press to pause, sit above the media,
          below the chrome (progress bars / header / bottom bar all have
          their own higher zIndex and pointerEvents box-none where needed). */}
      <View style={styles.tapZones} pointerEvents="box-none">
        <Pressable
          style={styles.tapZoneHalf}
          delayLongPress={LONG_PRESS_DELAY}
          onLongPress={pause}
          onPressOut={() => handlePressOut('left')}
        />
        <Pressable
          style={styles.tapZoneHalf}
          delayLongPress={LONG_PRESS_DELAY}
          onLongPress={pause}
          onPressOut={() => handlePressOut('right')}
        />
      </View>

      {/* Progress bars */}
      <View style={[styles.progressRow, { top: TOP_INSET }]} pointerEvents="none">
        {statuses.map((s, idx) => (
          <View key={s.id} style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: idx === activeIndex
                    ? progressAnims[idx].interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                    : (idx < activeIndex ? '100%' : '0%'),
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* Header - dims slightly while a long-press has paused the progress
          bar, a small live cue that something is actually paused. */}
      <View style={[styles.header, { top: TOP_INSET + 14, opacity: paused ? 0.5 : 1 }]} pointerEvents="box-none">
        <View style={styles.headerLeft}>
          {groupUser.profilePicture ? (
            <Image source={{ uri: groupUser.profilePicture }} style={styles.headerAvatar} />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Text style={styles.headerAvatarFallbackText}>{(groupUser.name || '?').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ marginLeft: spacing.sm }}>
            <Text style={styles.headerName}>{isOwn ? 'My Status' : (groupUser.name || 'Update')}</Text>
            <Text style={styles.headerTime}>{timeAgo(current.createdAt)}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {isOwn && (
            <TouchableOpacity onPress={handleDelete} disabled={deleting} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: spacing.lg }}>
              <Ionicons name="trash-outline" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Caption, above the bottom bar. Location/time/poll used to render
          here too as fixed-position overlays - they're now part of the
          dynamic sticker_positions renderer above (each at its own composed
          position, not a stacked column above the caption). */}
      <View style={styles.overlayBottom} pointerEvents="box-none">
        {current.caption && (
          <Text style={styles.caption} numberOfLines={3}>{current.caption}</Text>
        )}
      </View>

      {/* Bottom bar: reply, or (own status) view count */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.bottomBar}>
        {isOwn ? (
          <TouchableOpacity
            style={styles.viewCountRow}
            onPress={() => setViewersSheetOpen(true)}
            disabled={!current.viewCount}
          >
            <Ionicons name="eye-outline" size={18} color="#fff" />
            <Text style={styles.viewCountText}>
              {current.viewCount || 0} view{current.viewCount === 1 ? '' : 's'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.replyRow}>
            <TextInput
              style={styles.replyInput}
              placeholder={`Reply to ${groupUser.name || 'this update'}...`}
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={replyText}
              onChangeText={setReplyText}
              onFocus={pause}
            />
            <TouchableOpacity style={styles.replySendBtn} onPress={handleSendReply} disabled={!replyText.trim()}>
              <Ionicons name="send" size={18} color={replyText.trim() ? colors.accent : 'rgba(255,255,255,0.4)'} />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Own-status viewers list */}
      <Modal visible={viewersSheetOpen} transparent animationType="slide" onRequestClose={() => setViewersSheetOpen(false)}>
        <TouchableOpacity style={styles.viewersOverlay} activeOpacity={1} onPress={() => setViewersSheetOpen(false)}>
          <View style={styles.viewersSheet}>
            <Text style={styles.viewersTitle}>
              {current.viewCount || 0} view{current.viewCount === 1 ? '' : 's'}
            </Text>
            <FlatList
              data={current.viewers || []}
              keyExtractor={(v) => String(v.id)}
              style={{ maxHeight: 360 }}
              ListEmptyComponent={<Text style={styles.viewersEmpty}>No views yet</Text>}
              renderItem={({ item }) => (
                <View style={styles.viewerRow}>
                  {item.profilePicture ? (
                    <Image source={{ uri: item.profilePicture }} style={styles.viewerAvatar} />
                  ) : (
                    <View style={styles.viewerAvatarFallback}>
                      <Text style={styles.viewerAvatarFallbackText}>{(item.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={styles.viewerName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.viewerTime}>{timeAgo(item.viewedAt)}</Text>
                </View>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  mediaFill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  textFill: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  textContent: { color: '#fff', fontSize: 26, fontWeight: '600', textAlign: 'center' },

  tapZones: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', zIndex: 5 },
  tapZoneHalf: { flex: 1 },

  progressRow: {
    position: 'absolute', left: spacing.sm, right: spacing.sm, zIndex: 10,
    flexDirection: 'row', gap: 4,
  },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#fff' },

  header: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerAvatar: { width: 34, height: 34, borderRadius: 17 },
  headerAvatarFallback: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  headerAvatarFallbackText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  headerName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  headerTime: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 1 },

  overlayBottom: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: 92, zIndex: 8 },
  caption: { color: '#fff', fontSize: 14, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },

  // --- Saved sticker positions (Session 23) ---
  stickerPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  stickerPillText: { marginLeft: 4, fontSize: 12, fontWeight: '600', color: '#1a1a1a', maxWidth: 180 },
  stickerPollCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, minWidth: 200,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
  },
  stickerPollQuestion: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 8, textAlign: 'center' },
  stickerPollOption: { backgroundColor: '#f0f0f0', borderRadius: 8, padding: 8, marginBottom: 4 },
  stickerPollOptionText: { fontSize: 13, color: '#1a1a1a', textAlign: 'center' },
  stickerTextOverlay: {
    fontSize: 22, fontWeight: '700', color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 3,
  },

  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, zIndex: 10 },
  replyRow: { flexDirection: 'row', alignItems: 'center' },
  replyInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: radii.pill, color: '#fff', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: 14,
  },
  replySendBtn: { marginLeft: spacing.sm, padding: spacing.sm },

  viewCountRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  viewCountText: { color: '#fff', fontWeight: '600', marginLeft: spacing.xs, fontSize: 14 },

  viewersOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  viewersSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md,
    paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl,
  },
  viewersTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  viewersEmpty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  viewerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  viewerAvatar: { width: 36, height: 36, borderRadius: 18 },
  viewerAvatarFallback: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  viewerAvatarFallbackText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  viewerName: { flex: 1, marginLeft: spacing.md, fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  viewerTime: { fontSize: 12, color: colors.textMuted },
});
