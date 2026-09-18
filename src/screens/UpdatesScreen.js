// src/screens/UpdatesScreen.js
//
// Updates / Status tab. "My Status" (own active statuses, or a prompt to add
// one) above "Recent updates" (active statuses from contacts, unviewed-first
// - see GET /status/feed's ordering in routes/status.js). Viewing is handed
// off entirely to StatusViewerScreen via onViewStatus; posting to
// StatusCreatorScreen via onCreateStatus - this screen only lists.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  RefreshControl, ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getStatusFeed } from '../utils/api';
import EmptyState from '../components/EmptyState';
import { colors, spacing, radii, typography, shadow } from '../theme';

const AVATAR_SIZE = 52;
const THUMB_SIZE = 44;
const RING_GAP = 3;
const RING_BORDER = 2.5;
const RING_SIZE = AVATAR_SIZE + 2 * (RING_GAP + RING_BORDER);

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

// Ring wrapper for an avatar-sized child: solid blue (unviewed), solid grey
// (viewed), dashed grey ("add an update"), or no ring at all.
function StatusRing({ variant, children }) {
  if (variant === 'none') {
    return <View style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>{children}</View>;
  }
  const borderColor = variant === 'unviewed' ? colors.accent : colors.border;
  return (
    <View
      style={{
        width: RING_SIZE, height: RING_SIZE, borderRadius: RING_SIZE / 2,
        borderWidth: RING_BORDER, borderColor,
        borderStyle: variant === 'dashed' ? 'dashed' : 'solid',
        justifyContent: 'center', alignItems: 'center',
      }}
    >
      {children}
    </View>
  );
}

function Avatar({ uri, name, size }) {
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarFallbackText, { fontSize: size * 0.4 }]}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// Small preview swatch for a status: solid bg_color for text, a video icon
// tile for video (no poster-frame extraction available), the image itself
// for image.
function StatusThumb({ status, size = THUMB_SIZE, style }) {
  if (status.contentType === 'text') {
    return <View style={[styles.thumb, { width: size, height: size, backgroundColor: status.bgColor || colors.accent }, style]} />;
  }
  if (status.contentType === 'video') {
    return (
      <View style={[styles.thumb, styles.thumbVideo, { width: size, height: size }, style]}>
        <Ionicons name="videocam" size={size * 0.45} color="#fff" />
      </View>
    );
  }
  return <Image source={{ uri: status.content }} style={[styles.thumb, { width: size, height: size }, style]} resizeMode="cover" />;
}

function usePulse() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function SkeletonRow({ opacity }) {
  return (
    <View style={styles.row}>
      <Animated.View style={[styles.skeletonAvatar, { opacity }]} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Animated.View style={[styles.skeletonLine, { width: '50%', opacity }]} />
        <Animated.View style={[styles.skeletonLine, { width: '30%', marginTop: 8, opacity }]} />
      </View>
    </View>
  );
}

export default function UpdatesScreen({ currentUser, token, onCreateStatus, onViewStatus }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feed, setFeed] = useState({ mine: [], contacts: [] });
  const [error, setError] = useState(null);
  const pulse = usePulse();

  const loadFeed = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getStatusFeed(token);
      setFeed({ mine: Array.isArray(data.mine) ? data.mine : [], contacts: Array.isArray(data.contacts) ? data.contacts : [] });
    } catch (err) {
      setError(err.message || 'Could not load updates.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadFeed({ silent: true });
    setRefreshing(false);
  };

  const hasMine = feed.mine.length > 0;

  const handleMyStatusPress = () => {
    if (hasMine) onViewStatus({ user: currentUser, statuses: feed.mine });
    else onCreateStatus();
  };

  const myStatusSection = (
    <View>
      <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={handleMyStatusPress}>
        <StatusRing variant={hasMine ? 'unviewed' : 'dashed'}>
          <Avatar uri={currentUser?.profilePicture} name={currentUser?.name} size={AVATAR_SIZE} />
          {!hasMine && (
            <View style={styles.addBadge}>
              <Ionicons name="add" size={12} color="#fff" />
            </View>
          )}
        </StatusRing>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.rowName}>My Status</Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {hasMine ? `Updated ${timeAgo(feed.mine[0].createdAt)}` : 'Tap to add an update'}
          </Text>
        </View>
        <TouchableOpacity style={styles.cameraBtn} onPress={onCreateStatus} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="camera-outline" size={22} color={colors.accent} />
        </TouchableOpacity>
      </TouchableOpacity>

      {feed.contacts.length > 0 && <Text style={styles.sectionTitle}>Recent updates</Text>}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Updates</Text>
      </View>

      {loading ? (
        <View>
          <SkeletonRow opacity={pulse} />
          <SkeletonRow opacity={pulse} />
          <SkeletonRow opacity={pulse} />
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Could not load updates</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadFeed()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={feed.contacts}
          keyExtractor={(item) => String(item.user.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={myStatusSection}
          ListEmptyComponent={
            <EmptyState
              icon="status"
              title="No updates yet"
              body="When your contacts post status updates, they will appear here"
            />
          }
          renderItem={({ item }) => {
            const latest = item.statuses[0];
            return (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => onViewStatus(item)}>
                <StatusRing variant={item.hasUnviewed ? 'unviewed' : 'viewed'}>
                  <Avatar uri={item.user.profilePicture} name={item.user.name} size={AVATAR_SIZE} />
                </StatusRing>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.user.name || 'Update'}</Text>
                  <Text style={styles.rowSub}>{timeAgo(latest.createdAt)}</Text>
                </View>
                <StatusThumb status={latest} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={onCreateStatus} activeOpacity={0.85}>
        <Ionicons name="camera" size={24} color={colors.textOnAccent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground, borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  headerTitle: { ...typography.headerTitle, color: colors.textPrimary },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
  },
  rowName: { ...typography.rowName, color: colors.textPrimary },
  rowSub: { ...typography.rowPreview, color: colors.textSecondary, marginTop: 2 },
  cameraBtn: { padding: spacing.sm },

  avatarFallback: { backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: colors.textOnAccent, fontWeight: '600' },
  addBadge: {
    position: 'absolute', bottom: -1, right: -1, width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.background,
    justifyContent: 'center', alignItems: 'center',
  },

  thumb: { borderRadius: radii.sm, backgroundColor: colors.surface },
  thumbVideo: { justifyContent: 'center', alignItems: 'center' },

  sectionTitle: {
    fontSize: 13, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs,
  },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },
  emptySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radii.sm,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xl,
  },
  retryBtnText: { color: colors.textOnAccent, fontWeight: '600' },

  skeletonAvatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, backgroundColor: colors.surface },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: colors.surface },

  fab: {
    position: 'absolute', bottom: 28, right: 20, width: 56, height: 56,
    borderRadius: 28, backgroundColor: colors.accent, justifyContent: 'center',
    alignItems: 'center', ...shadow.md
  },
});
