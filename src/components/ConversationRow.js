// src/components/ConversationRow.js
//
// One conversation row - avatar (initials) + online dot + name + time +
// last-message preview + unread badge. Shared by ChatListScreen (main list)
// and ArchivedChatsScreen so the two lists stay visually identical.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { colors, spacing, radii, typography } from '../theme';

export function previewText(lastMessage) {
  if (!lastMessage) return 'No messages yet';
  if (lastMessage.message_type === 'image') return 'Photo';
  if (lastMessage.message_type === 'audio') return 'Voice message';
  if (lastMessage.message_type === 'location') return 'Location';
  // 'file' falls through to content, which is the original filename for a
  // file message - already a reasonable one-line preview on its own.
  return lastMessage.content;
}

// Fixed-size slot around the avatar for the Updates status ring (Session 19
// - see UpdatesScreen.js / ChatListScreen.js). Always reserves the same
// outer box whether or not a ring is drawn, so rows don't jitter depending
// on which contacts happen to have an active status. Purely decorative -
// the ring itself is never tappable; status is only ever opened from the
// Updates tab. The avatar underneath it has its own onPress (see
// onAvatarPress below), separate from the row's.
const AVATAR_SIZE = 52;
const RING_GAP = 3;
const RING_BORDER = 2.5;
const RING_SIZE = AVATAR_SIZE + 2 * (RING_GAP + RING_BORDER);

function AvatarStatusRing({ variant, children }) {
  const showRing = variant === 'unviewed' || variant === 'viewed';
  return (
    <View
      style={{
        width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
        borderWidth: showRing ? RING_BORDER : 0,
        borderColor: variant === 'unviewed' ? colors.accent : colors.border,
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      {children}
    </View>
  );
}

export default function ConversationRow({ item, presenceMap, unviewedStatusUserIds, viewedStatusUserIds, onPress, onLongPress, onAvatarPress }) {
  const isGroup = !!item.is_group;
  const title = isGroup ? item.name : item.with?.name;
  const online = !isGroup && item.with?.id != null && !!presenceMap?.get?.(item.with.id)?.online;
  const hasUnread = item.unreadCount > 0;
  // 1:1 chats carry the other party's picture on `with.profilePicture` (base64
  // data URI or null) - GET /conversations already includes it. Groups have no
  // picture concept, so they always fall back to the initial.
  const avatarUri = !isGroup ? (item.with?.profilePicture || null) : null;
  const otherId = !isGroup ? item.with?.id : null;
  const statusVariant = otherId != null && unviewedStatusUserIds?.has?.(otherId)
    ? 'unviewed'
    : (otherId != null && viewedStatusUserIds?.has?.(otherId) ? 'viewed' : 'none');

  return (
    <TouchableOpacity
      activeOpacity={0.6}
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <AvatarStatusRing variant={statusVariant}>
        <TouchableOpacity
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={(e) => {
            e?.stopPropagation?.();
            if (onAvatarPress) onAvatarPress();
            else onPress?.();
          }}
        >
          <View>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(title || '?').charAt(0).toUpperCase()}</Text>
              </View>
            )}
            {online && <View style={styles.onlineDot} />}
          </View>
        </TouchableOpacity>
      </AvatarStatusRing>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowName} numberOfLines={1}>{title || 'Chat'}</Text>
          {item.lastMessage?.created_at && (
            <Text style={styles.rowTime}>
              {new Date(item.lastMessage.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          )}
        </View>
        <View style={styles.rowBottomLine}>
          <Text style={[styles.rowSub, hasUnread && styles.rowSubUnread]} numberOfLines={1}>
            {previewText(item.lastMessage)}
          </Text>
          {hasUnread && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  avatarText: { color: colors.textOnAccent, fontSize: 20, fontWeight: '600' },
  onlineDot: {
    // 10px green circle, 2px white ring, bottom-right of the avatar. Nothing
    // rendered at all when offline (no grey dot).
    position: 'absolute', bottom: 0, right: 0, width: 10, height: 10,
    borderRadius: 5, backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#FFFFFF'
  },
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { ...typography.rowName, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  rowTime: { ...typography.timestamp, color: colors.textMuted },
  rowBottomLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  rowSub: { ...typography.rowPreview, color: colors.textSecondary, flex: 1, marginRight: spacing.sm },
  rowSubUnread: { color: colors.textPrimary, fontWeight: '600' },
  unreadBadge: {
    backgroundColor: colors.unreadBadge, borderRadius: radii.pill, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6
  },
  unreadBadgeText: { color: colors.textOnAccent, fontSize: 11, fontWeight: '700' },
});
