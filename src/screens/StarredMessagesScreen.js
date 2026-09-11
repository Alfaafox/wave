// src/screens/StarredMessagesScreen.js
//
// Full-screen list of every message the current user has starred, across all
// conversations (GET /users/me/starred-messages). Tap a row to open that
// conversation scrolled to the message; long-press to unstar. 20 per page,
// infinite scroll.

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { getStarredMessages, getConversations, unstarMessage } from '../utils/api';

const PAGE = 20;

function snippet(item) {
  if (item.message_type === 'image') return 'Photo';
  if (item.message_type === 'audio') return 'Voice message';
  if (item.message_type === 'location') return 'Location';
  return (item.content || '').replace(/\s+/g, ' ').trim();
}

function convTitle(item) {
  if (item.is_group) return item.group_name || 'Group';
  return item.conversation_name || item.sender_name || 'Chat';
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
  );
}

export default function StarredMessagesScreen({ token, onBack, onOpenChat }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  // conversationId -> full conversation object from GET /conversations, so a
  // row tap can hand ChatScreen the same rich `with` object ChatListScreen does.
  const convMapRef = useRef({});

  const load = useCallback(async (offset) => {
    const data = await getStarredMessages(token, { limit: PAGE, offset });
    setError(null);
    setItems((prev) => (offset === 0 ? (data.results || []) : [...prev, ...(data.results || [])]));
    setTotal(data.total || 0);
    setHasMore(!!data.hasMore);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      getConversations(token)
        .then((list) => {
          if (cancelled) return;
          const map = {};
          (Array.isArray(list) ? list : []).forEach((c) => { map[c.id] = c; });
          convMapRef.current = map;
        })
        .catch(() => {});
      try {
        await load(0);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load starred messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load, token]);

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    try {
      await load(items.length);
    } catch (err) {
      /* keep what we have; a transient page error shouldn't wipe the list */
    } finally {
      setLoadingMore(false);
    }
  };

  const retry = () => {
    setLoading(true);
    load(0)
      .catch((err) => setError(err.message || 'Could not load starred messages'))
      .finally(() => setLoading(false));
  };

  const openRow = (item) => {
    const conv = convMapRef.current[item.conversation_id];
    onOpenChat({
      conversationId: item.conversation_id,
      otherUser: conv
        ? conv.with
        : {
            id: item.conversation_user_id ?? null,
            name: item.conversation_name || item.sender_name,
            profilePicture: item.conversation_picture || null,
          },
      isGroup: conv ? !!conv.is_group : !!item.is_group,
      groupName: conv ? conv.name : item.group_name,
      scrollToMessageId: item.id,
    });
  };

  const unstarRow = (item) => {
    Alert.alert('Unstar message?', 'This removes it from Starred Messages.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unstar',
        style: 'destructive',
        onPress: async () => {
          const prev = items;
          setItems((cur) => cur.filter((m) => m.id !== item.id));
          setTotal((t) => Math.max(0, t - 1));
          try {
            await unstarMessage(token, item.conversation_id, item.id);
          } catch (err) {
            setItems(prev);
            setTotal((t) => t + 1);
            Alert.alert('Could not unstar', err.message);
          }
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const title = convTitle(item);
    const pic = item.is_group ? null : (item.conversation_picture || null);
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.6}
        onPress={() => openRow(item)}
        onLongPress={() => unstarRow(item)}
      >
        {pic ? (
          <Image source={{ uri: pic }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{(title || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          {!!item.is_group && (
            <Text style={styles.rowSender} numberOfLines={1}>{item.sender_name}</Text>
          )}
          <Text style={styles.rowSnippet} numberOfLines={2}>{snippet(item)}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowDate}>{fmtDate(item.created_at)}</Text>
          <Ionicons name="star" size={15} color="#FFD700" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Starred Messages</Text>
          {total > 0 && (
            <Text style={styles.headerCount}>{total} message{total === 1 ? '' : 's'}</Text>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="warning-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{error}</Text>
          <TouchableOpacity onPress={retry}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="star-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No starred messages yet</Text>
          <Text style={styles.emptySub}>Star messages to save them here</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `star-${item.id}`}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} /> : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder,
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  headerCount: { color: colors.textMuted, fontSize: 12, marginTop: 1 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: colors.textOnAccent, fontSize: 16, fontWeight: '700' },
  rowBody: { flex: 1, marginLeft: spacing.md },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowSender: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  rowSnippet: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', marginLeft: spacing.sm, gap: 4 },
  rowDate: { fontSize: 11, color: colors.textMuted },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  emptySub: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  retry: { fontSize: 14, color: colors.accent, fontWeight: '600', marginTop: spacing.md },
});
