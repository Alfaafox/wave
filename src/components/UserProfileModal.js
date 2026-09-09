// src/components/UserProfileModal.js
//
// Bottom-sheet modal opened by tapping the chat header in ChatScreen.
//   - 1:1  : photo / name / phone / last seen / online, call buttons, favourite
//            star, a media preview row, mute toggle, a row into
//            ContactNotificationSettings, a Private Chat toggle, block/unblock.
//   - group: group name + member count, scrollable member list, leave group.
//
// The sheet slides up (Modal animationType="slide") and can also be dragged
// down to dismiss via a PanResponder on the drag handle - the same manual
// Animated + PanResponder pattern ImageViewerModal.js uses.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, Image, ScrollView, TouchableOpacity, Pressable,
  StyleSheet, Animated, PanResponder, Switch, Alert, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../theme';
import {
  getConversations, getConversationMute, getPrivacySettings, blockUser, unblockUser, deleteConversation,
  setPrivateChat,
} from '../utils/api';
import { isFavourite, toggleFavourite } from '../utils/favourites';
import FavouriteStar from './FavouriteStar';
import ImageViewerModal from './ImageViewerModal';

const SCREEN_HEIGHT = Dimensions.get('window').height;
const DISMISS_THRESHOLD = 110;

function initials(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function lastSeenLabel(other) {
  if (!other || other.status === 'deleted' || other.status === 'inactive') return '';
  if (!other.last_seen) return '';
  const d = new Date(other.last_seen);
  if (Number.isNaN(d.getTime())) return '';
  return `Last seen ${d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

function Avatar({ uri, name, size }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarFallbackText, { fontSize: size * 0.4 }]}>{initials(name)}</Text>
    </View>
  );
}

export default function UserProfileModal({
  visible,
  onClose,
  token,
  // The logged-in user. Passed through from ChatScreen for completeness of the
  // contract; not consumed yet (block / favourite / mute / private-chat all key
  // off `otherUser` + `token`).
  currentUser,
  isGroup,
  groupName,
  conversationId,
  otherUser,
  onStartCall,
  muted,
  onMuteChange,
  onOpenNotifications,
  onLeaveGroup,
  // Presence map owned by App.js (userId -> { online, lastSeen }), threaded
  // through ChatScreen. Named `presenceMap` upstream; passed here as `onlineUsers`.
  onlineUsers,
  // Up to 3 URIs of the most recent image-type messages (newest first),
  // derived from ChatScreen's messages state.
  recentImages,
  // Private Chat mode for this conversation (server-backed). `onPrivateChatChange`
  // lets ChatScreen update its header lock / state the instant we toggle,
  // ahead of the privateChatEnabled/Disabled socket event.
  privateChat,
  onPrivateChatChange,
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  // onClose is captured in a ref so the PanResponder (built once) always calls
  // the latest handler without being rebuilt on every ChatScreen re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [favourite, setFavourite] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [privateBusy, setPrivateBusy] = useState(false);

  const otherId = otherUser?.id ?? null;
  const avatarUri = isGroup ? null : otherUser?.profilePicture || null;

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(0);
    setPhotoViewerOpen(false);

    let cancelled = false;

    if (isGroup) {
      setMembersLoading(true);
      getConversations(token)
        .then((list) => {
          if (cancelled) return;
          const conv = (Array.isArray(list) ? list : []).find((c) => String(c.id) === String(conversationId));
          setMembers(Array.isArray(conv?.members) ? conv.members : []);
        })
        .catch(() => { if (!cancelled) setMembers([]); })
        .finally(() => { if (!cancelled) setMembersLoading(false); });
    } else if (otherId != null) {
      isFavourite(otherId).then((v) => { if (!cancelled) setFavourite(v); });
      getPrivacySettings(token)
        .then((data) => {
          if (cancelled) return;
          const list = data?.blockedUsers || [];
          setBlocked(list.some((u) => u.id === otherId));
        })
        .catch(() => {});
      // Mute: the server is the source of truth. The toggle already shows the
      // cached value instantly; this reconciles it on open (e.g. changed on
      // another device). `skipSync` tells ChatScreen not to POST it back.
      getConversationMute(token, conversationId)
        .then((r) => {
          if (!cancelled && typeof r?.muted === 'boolean') onMuteChange?.(r.muted, { skipSync: true });
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
  }, [visible, isGroup, otherId, conversationId, token, translateY]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_THRESHOLD) {
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 180, useNativeDriver: true })
              .start(() => onCloseRef.current()); // translateY is reset by the visible effect on reopen
          } else {
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          }
        },
      }),
    [translateY]
  );

  const handleToggleFavourite = async () => {
    const next = await toggleFavourite(otherId);
    setFavourite(next);
  };

  const handleCall = (type) => {
    if (!otherUser?.id) return;
    onClose();
    onStartCall?.(otherUser.id, otherUser.name, type);
  };

  const handleBlock = () => {
    if (otherId == null || blockBusy) return;
    const label = blocked ? 'Unblock' : 'Block';
    Alert.alert(
      `${label} ${otherUser.name || 'this contact'}?`,
      blocked
        ? 'They will be able to call and message you again.'
        : 'They will no longer be able to call or message you. They are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: label,
          style: blocked ? 'default' : 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              if (blocked) await unblockUser(token, otherId);
              else await blockUser(token, otherId);
              setBlocked(!blocked);
            } catch (err) {
              Alert.alert('Error', err.message);
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ]
    );
  };

  const applyPrivateChat = async (enable) => {
    if (privateBusy || otherId == null) return;
    setPrivateBusy(true);
    // Optimistic: ChatScreen flips its header lock now; the socket event
    // confirms. Roll back on failure.
    onPrivateChatChange?.(enable);
    try {
      const r = await setPrivateChat(token, conversationId, enable);
      if (typeof r?.private_chat === 'number') onPrivateChatChange?.(r.private_chat === 1);
    } catch (err) {
      onPrivateChatChange?.(!enable);
      Alert.alert('Could not update Private Chat', err.message);
    } finally {
      setPrivateBusy(false);
    }
  };

  const openPrivateChatDialog = () => {
    if (privateBusy) return;
    const on = !!privateChat;
    Alert.alert(
      'Private Chat',
      'Private Chat adds these protections to this conversation:\n\n'
        + '- Messages disappear after 7 days\n'
        + '- Read receipts are turned off\n'
        + '- Notifications hide message content\n\n'
        + (on
          ? 'It is currently ON. Both of you will see a note in the chat if you turn it off.'
          : 'Both of you will see a note in the chat when it is turned on.'),
      on
        ? [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Disable Private Chat', style: 'destructive', onPress: () => applyPrivateChat(false) },
          ]
        : [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Enable Private Chat', onPress: () => applyPrivateChat(true) },
          ]
    );
  };

  const handleLeaveGroup = () => {
    if (leaveBusy) return;
    Alert.alert('Leave group?', `You will stop receiving messages from "${groupName || 'this group'}".`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setLeaveBusy(true);
          try {
            await deleteConversation(token, conversationId);
            onClose();
            onLeaveGroup?.();
          } catch (err) {
            Alert.alert('Could not leave group', err.message);
          } finally {
            setLeaveBusy(false);
          }
        },
      },
    ]);
  };

  if (!visible) return null;

  const seen = lastSeenLabel(otherUser);
  const online = !isGroup && otherId != null && !!onlineUsers?.get?.(otherId)?.online;
  const images = Array.isArray(recentImages) ? recentImages.filter(Boolean).slice(0, 3) : [];
  const memberCount = members.length + 1; // server excludes the current user

  const showComingSoon = () => Alert.alert('Coming soon');

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View {...panResponder.panHandlers} style={styles.handleArea}>
              <View style={styles.handle} />
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {isGroup ? (
                <>
                  <View style={styles.headerBlock}>
                    <Avatar uri={null} name={groupName} size={104} />
                    <Text style={styles.name}>{groupName || 'Group'}</Text>
                    <Text style={styles.sub}>
                      {membersLoading ? 'Loading members...' : `${memberCount} member${memberCount === 1 ? '' : 's'}`}
                    </Text>
                  </View>

                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>Members</Text>

                  {membersLoading ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
                  ) : (
                    members.map((m) => (
                      <View key={String(m.id)} style={styles.memberRow}>
                        <Avatar uri={m.profilePicture || null} name={m.name} size={40} />
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                          <Text style={styles.memberName} numberOfLines={1}>{m.name || 'Unknown'}</Text>
                          {!!m.phone_number && <Text style={styles.memberPhone} numberOfLines={1}>{m.phone_number}</Text>}
                        </View>
                      </View>
                    ))
                  )}

                  <TouchableOpacity style={styles.dangerRow} onPress={handleLeaveGroup} disabled={leaveBusy}>
                    <Ionicons name="exit-outline" size={20} color={colors.danger} style={{ marginRight: spacing.md }} />
                    <Text style={styles.dangerText}>{leaveBusy ? 'Leaving...' : 'Leave group'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.headerBlock}>
                    <FavouriteStar
                      filled={favourite}
                      onToggle={handleToggleFavourite}
                      disabled={otherId == null}
                      style={styles.starTopRight}
                    />
                    <Pressable
                      onPress={avatarUri ? () => setPhotoViewerOpen(true) : undefined}
                      disabled={!avatarUri}
                    >
                      <Avatar uri={avatarUri} name={otherUser?.name} size={104} />
                    </Pressable>
                    <Text style={styles.name}>{otherUser?.name || 'Unknown'}</Text>
                    {!!otherUser?.phone_number && <Text style={styles.sub}>{otherUser.phone_number}</Text>}
                    {!!seen && <Text style={styles.sub}>{seen}</Text>}
                    {online && <Text style={styles.onlineText}>Online</Text>}
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => handleCall('audio')} disabled={!otherUser?.id}>
                      <View style={styles.actionCircle}>
                        <Ionicons name="call" size={22} color={colors.accent} />
                      </View>
                      <Text style={styles.actionLabel}>Audio</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => handleCall('video')} disabled={!otherUser?.id}>
                      <View style={styles.actionCircle}>
                        <Ionicons name="videocam" size={22} color={colors.accent} />
                      </View>
                      <Text style={styles.actionLabel}>Video</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.divider} />

                  <TouchableOpacity style={styles.row} onPress={showComingSoon}>
                    <Ionicons name="images-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.rowLabel}>Media, Links &amp; Docs</Text>
                    {images.length > 0 ? (
                      <View style={styles.mediaThumbs}>
                        {images.map((uri, i) => (
                          <Image key={String(i)} source={{ uri }} style={styles.mediaThumb} />
                        ))}
                      </View>
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>

                  <View style={styles.row}>
                    <Ionicons name="notifications-off-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.rowLabel}>Mute notifications</Text>
                    <Switch
                      value={!!muted}
                      onValueChange={(v) => onMuteChange?.(v)}
                      trackColor={{ false: colors.border, true: colors.accent }}
                    />
                  </View>

                  <TouchableOpacity style={styles.row} onPress={onOpenNotifications}>
                    <Ionicons name="notifications-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.rowLabel}>Notifications</Text>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.row} onPress={openPrivateChatDialog} disabled={privateBusy}>
                    <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.rowIcon} />
                    <Text style={styles.rowLabel}>Private Chat</Text>
                    <Text style={[styles.rowValue, privateChat && styles.rowValueOn]}>
                      {privateBusy ? '...' : privateChat ? 'On' : 'Off'}
                    </Text>
                    <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                  </TouchableOpacity>

                  <View style={styles.divider} />

                  <TouchableOpacity style={styles.dangerRow} onPress={handleBlock} disabled={blockBusy}>
                    <Ionicons
                      name={blocked ? 'checkmark-circle-outline' : 'ban-outline'}
                      size={20}
                      color={colors.danger}
                      style={{ marginRight: spacing.md }}
                    />
                    <Text style={styles.dangerText}>
                      {blockBusy ? 'Working...' : `${blocked ? 'Unblock' : 'Block'} ${otherUser?.name || 'contact'}`}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <ImageViewerModal
        visible={photoViewerOpen && !!avatarUri}
        uri={avatarUri}
        onClose={() => setPhotoViewerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '88%',
    paddingBottom: spacing.xl,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle: { width: 40, height: 5, borderRadius: radii.pill, backgroundColor: colors.border },
  sheetContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

  headerBlock: { alignItems: 'center', paddingVertical: spacing.lg },
  starTopRight: { position: 'absolute', top: 0, right: 0, padding: spacing.xs },
  avatarFallback: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: colors.textOnAccent, fontWeight: '700' },
  name: { ...typography.headerTitle, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  onlineText: { fontSize: 13, color: '#4CAF50', fontWeight: '600', marginTop: 2, textAlign: 'center' },

  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xxl, paddingVertical: spacing.md },
  actionBtn: { alignItems: 'center' },
  actionCircle: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  actionLabel: { fontSize: 12, color: colors.accent, marginTop: spacing.xs, fontWeight: '600' },

  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: spacing.sm, marginBottom: spacing.xs,
  },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowIcon: { marginRight: spacing.md },
  rowLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
  rowValue: { fontSize: 14, color: colors.textSecondary, marginRight: spacing.xs },
  rowValueOn: { color: '#4CAF50', fontWeight: '600' },
  mediaThumbs: { flexDirection: 'row', gap: spacing.xs },
  mediaThumb: { width: 60, height: 60, borderRadius: 4, backgroundColor: colors.surface },

  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  memberName: { fontSize: 15, color: colors.textPrimary },
  memberPhone: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  dangerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  dangerText: { fontSize: 15, color: colors.danger, fontWeight: '600' },
});
