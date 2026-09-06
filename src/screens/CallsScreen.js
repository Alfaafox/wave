import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, SectionList, RefreshControl,
  TouchableOpacity, Animated, PanResponder, Alert, Modal, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { getCallHistory, deleteCall, clearCallHistory, startConversation } from '../utils/api';
import { getSocket } from '../utils/socket';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatFullDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function dayLabel(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const startOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' });
}

function statusLabel(call, isOutgoing) {
  switch (call.status) {
    case 'completed':
      return formatDuration(call.duration_seconds) || 'Call ended';
    case 'missed':
      return isOutgoing ? 'No answer' : 'Missed call';
    case 'declined':
      return isOutgoing ? 'Declined' : 'You declined';
    case 'busy':
      return 'Busy';
    case 'ringing':
    case 'active':
      return 'In progress';
    default:
      return call.status;
  }
}

function groupIntoSections(calls) {
  const map = new Map();
  for (const call of calls) {
    const label = dayLabel(call.started_at);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(call);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

function CallRow({ item, currentUser, onDelete, onPress }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const rowHeight = useRef(new Animated.Value(1)).current;
  const [removed, setRemoved] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx < 0) translateX.setValue(gesture.dx);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -100) {
          Animated.timing(translateX, { toValue: -400, duration: 200, useNativeDriver: true }).start(() => {
            Animated.timing(rowHeight, { toValue: 0, duration: 150, useNativeDriver: false }).start(() => {
              setRemoved(true);
              onDelete(item.id);
            });
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  if (removed) return null;

  const isOutgoing = item.caller_id === currentUser.id;
  const otherName = isOutgoing ? item.callee_name : item.caller_name;
  const missedOrDeclined = item.status === 'missed' || item.status === 'declined' || item.status === 'busy';

  return (
    <Animated.View style={{ maxHeight: rowHeight.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }) }}>
      <View style={styles.rowWrap}>
        <View style={styles.deleteBackdrop}>
          <Ionicons name="trash" size={20} color="#fff" />
        </View>
        <Animated.View
          style={[styles.row, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity style={styles.rowTouchable} activeOpacity={0.7} onPress={() => onPress(item)}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{(otherName || '?').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.rowMiddle}>
              <Text style={[styles.rowName, missedOrDeclined && !isOutgoing && styles.missedText]}>
                {otherName || 'Unknown'}
              </Text>
              <View style={styles.rowSubline}>
                <Ionicons
                  name="call-outline"
                  size={13}
                  color={missedOrDeclined && !isOutgoing ? colors.danger || '#E53935' : colors.textSecondary}
                  style={{ marginRight: 4, transform: [{ rotate: isOutgoing ? '135deg' : '0deg' }] }}
                />
                <Text style={[styles.rowSubtext, missedOrDeclined && !isOutgoing && styles.missedText]}>
                  {statusLabel(item, isOutgoing)}
                </Text>
              </View>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowTime}>{formatTime(item.started_at)}</Text>
              <Ionicons name={item.call_type === 'video' ? 'videocam-outline' : 'call-outline'} size={18} color={colors.textMuted} />
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export default function CallsScreen({ token, currentUser, onStartCall, onOpenChat }) {
  const [calls, setCalls] = useState(null); // null = initial loading
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState(null);
  const [detailsFor, setDetailsFor] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await getCallHistory(token, { limit: 20 });
      setCalls(res.calls || []);
      setHasMore(!!res.hasMore);
    } catch (err) {
      setError(err.message);
      setCalls([]);
      setHasMore(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleUpdate = () => load();
    socket.on('call:historyUpdated', handleUpdate);
    return () => socket.off('call:historyUpdated', handleUpdate);
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore || !calls || calls.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestId = calls[calls.length - 1].id;
      const res = await getCallHistory(token, { before: oldestId, limit: 20 });
      setCalls((prev) => [...prev, ...(res.calls || [])]);
      setHasMore(!!res.hasMore);
    } catch (err) {
      // Silent — a failed "load more" shouldn't disrupt what's already on screen.
      console.warn('[CallsScreen] loadMore failed:', err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDelete = async (callId) => {
    setCalls((prev) => (prev || []).filter((c) => c.id !== callId));
    try {
      await deleteCall(token, callId);
    } catch (err) {
      Alert.alert('Could not delete', err.message);
      load();
    }
  };

  const handleClearAll = () => {
    Alert.alert('Clear call history?', 'This removes all calls from your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear all',
        style: 'destructive',
        onPress: async () => {
          const previous = calls;
          setCalls([]);
          try {
            await clearCallHistory(token);
          } catch (err) {
            Alert.alert('Could not clear history', err.message);
            setCalls(previous);
          }
        },
      },
    ]);
  };

  const handleCall = (call, callType) => {
    const isOutgoing = call.caller_id === currentUser.id;
    const targetId = isOutgoing ? call.callee_id : call.caller_id;
    const targetName = isOutgoing ? call.callee_name : call.caller_name;
    setDetailsFor(null);
    onStartCall && onStartCall(targetId, targetName, callType);
  };

  const handleMessage = async (call) => {
    const isOutgoing = call.caller_id === currentUser.id;
    const targetPhone = isOutgoing ? call.callee_phone : call.caller_phone;
    setDetailsFor(null);
    if (!targetPhone) {
      Alert.alert('Cannot open chat', 'No phone number on record for this contact.');
      return;
    }
    try {
      const result = await startConversation(token, targetPhone);
      onOpenChat && onOpenChat({ conversationId: result.conversationId, otherUser: result.with, isGroup: false });
    } catch (err) {
      Alert.alert('Could not open chat', err.message);
    }
  };

  const sections = calls ? groupIntoSections(calls) : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calls</Text>
        {calls && calls.length > 0 && (
          <TouchableOpacity onPress={handleClearAll}>
            <Text style={styles.clearAllText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      {calls === null ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.emptySubtitle}>Loading...</Text>
        </View>
      ) : calls.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="call-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No call history yet</Text>
          <Text style={styles.emptySubtitle}>
            {error ? `Couldn't load calls: ${error}` : 'Your voice and video calls will appear here.'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <CallRow item={item} currentUser={currentUser} onDelete={handleDelete} onPress={setDetailsFor} />
          )}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.sectionHeader}>{title}</Text>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ paddingBottom: spacing.xl }}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? (
            <View style={{ paddingVertical: spacing.md }}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null}
        />
      )}

      <Modal visible={!!detailsFor} transparent animationType="fade" onRequestClose={() => setDetailsFor(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDetailsFor(null)}>
          {detailsFor && (
            <View style={styles.detailsBox}>
              {(() => {
                const isOutgoing = detailsFor.caller_id === currentUser.id;
                const otherName = isOutgoing ? detailsFor.callee_name : detailsFor.caller_name;
                return (
                  <>
                    <View style={styles.detailsAvatar}>
                      <Text style={styles.detailsAvatarText}>{(otherName || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.detailsName}>{otherName || 'Unknown'}</Text>
                    <Text style={styles.detailsStatus}>{statusLabel(detailsFor, isOutgoing)}</Text>

                    <View style={styles.detailsDivider} />

                    <View style={styles.detailsRow}>
                      <Text style={styles.detailsLabel}>Type</Text>
                      <Text style={styles.detailsValue}>{detailsFor.call_type === 'video' ? 'Video call' : 'Voice call'}</Text>
                    </View>
                    <View style={styles.detailsRow}>
                      <Text style={styles.detailsLabel}>Direction</Text>
                      <Text style={styles.detailsValue}>{isOutgoing ? 'Outgoing' : 'Incoming'}</Text>
                    </View>
                    <View style={styles.detailsRow}>
                      <Text style={styles.detailsLabel}>Started</Text>
                      <Text style={styles.detailsValue}>{formatFullDateTime(detailsFor.started_at)}</Text>
                    </View>
                    {!!detailsFor.answered_at && (
                      <View style={styles.detailsRow}>
                        <Text style={styles.detailsLabel}>Answered</Text>
                        <Text style={styles.detailsValue}>{formatFullDateTime(detailsFor.answered_at)}</Text>
                      </View>
                    )}
                    {!!detailsFor.ended_at && (
                      <View style={styles.detailsRow}>
                        <Text style={styles.detailsLabel}>Ended</Text>
                        <Text style={styles.detailsValue}>{formatFullDateTime(detailsFor.ended_at)}</Text>
                      </View>
                    )}
                    {!!detailsFor.duration_seconds && (
                      <View style={styles.detailsRow}>
                        <Text style={styles.detailsLabel}>Duration</Text>
                        <Text style={styles.detailsValue}>{formatDuration(detailsFor.duration_seconds)}</Text>
                      </View>
                    )}

                    <View style={styles.actionRow}>
                      <TouchableOpacity style={styles.actionButton} onPress={() => handleMessage(detailsFor)}>
                        <Ionicons name="chatbubble" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Message</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionButton} onPress={() => handleCall(detailsFor, 'audio')}>
                        <Ionicons name="call" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Voice</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionButton} onPress={() => handleCall(detailsFor, 'video')}>
                        <Ionicons name="videocam" size={18} color="#fff" />
                        <Text style={styles.actionButtonText}>Video</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                );
              })()}
            </View>
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground, borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  clearAllText: { fontSize: 14, color: colors.accent, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },
  emptySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  sectionHeader: {
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  rowWrap: { position: 'relative', overflow: 'hidden' },
  deleteBackdrop: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 90,
    backgroundColor: colors.danger || '#E53935', justifyContent: 'center', alignItems: 'center',
  },
  row: { backgroundColor: colors.background },
  rowTouchable: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder, backgroundColor: colors.background,
  },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#2C6BED',
    justifyContent: 'center', alignItems: 'center', marginRight: spacing.md,
  },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  rowMiddle: { flex: 1 },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  rowSubline: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  rowSubtext: { fontSize: 13, color: colors.textSecondary },
  missedText: { color: colors.danger || '#E53935' },
  rowRight: { alignItems: 'flex-end' },
  rowTime: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay || 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  detailsBox: {
    backgroundColor: colors.background, borderRadius: 20, padding: spacing.xl, width: '82%', alignItems: 'center',
  },
  detailsAvatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#2C6BED',
    justifyContent: 'center', alignItems: 'center', marginBottom: spacing.md,
  },
  detailsAvatarText: { color: '#fff', fontSize: 28, fontWeight: '600' },
  detailsName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  detailsStatus: { fontSize: 14, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  detailsDivider: { height: 1, backgroundColor: colors.headerBorder, width: '100%', marginBottom: spacing.md },
  detailsRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: spacing.sm },
  detailsLabel: { fontSize: 13, color: colors.textSecondary },
  detailsValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  actionRow: { flexDirection: 'row', width: '100%', marginTop: spacing.md, gap: spacing.sm },
  actionButton: {
    flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2C6BED', borderRadius: 16, paddingVertical: spacing.md,
  },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 12, marginTop: 4 },
});

