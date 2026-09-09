// src/screens/ArchivedChatsScreen.js
//
// Full-screen list of the user's archived conversations
// (GET /conversations/archived). Same row component as the main chat list.
// Tap -> open the chat normally. Long-press -> Unarchive. A new message in an
// archived chat auto-unarchives it server-side (conversationUnarchived event),
// so it drops off this list on its own.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { connectSocket } from '../utils/socket';
import { getArchivedConversations, unarchiveConversation } from '../utils/api';
import ConversationRow from '../components/ConversationRow';

export default function ArchivedChatsScreen({ token, presenceMap, onBack, onOpenChat }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getArchivedConversations(token);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();

    const socket = connectSocket(token);
    const refetch = () => load();
    const onUnarchived = ({ conversationId }) => {
      setItems((prev) => prev.filter((c) => c.id !== conversationId));
    };
    socket.on('conversationArchived', refetch);
    socket.on('conversationUnarchived', onUnarchived);
    socket.on('conversationActivity', refetch);
    socket.on('message', refetch);

    return () => {
      cancelled = true;
      socket.off('conversationArchived', refetch);
      socket.off('conversationUnarchived', onUnarchived);
      socket.off('conversationActivity', refetch);
      socket.off('message', refetch);
    };
  }, [load, token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleUnarchive = async (item) => {
    const prev = items;
    setItems((cur) => cur.filter((c) => c.id !== item.id));
    try {
      await unarchiveConversation(token, item.id);
    } catch (err) {
      setItems(prev);
      Alert.alert('Could not unarchive', err.message);
    }
  };

  const handleLongPress = (item) => {
    const title = item.is_group ? item.name : item.with?.name;
    Alert.alert(title || 'Chat', undefined, [
      { text: 'Unarchive', onPress: () => handleUnarchive(item) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Archived</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="archive-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>No archived chats</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              presenceMap={presenceMap}
              onPress={() => onOpenChat({
                conversationId: item.id,
                otherUser: item.with,
                isGroup: !!item.is_group,
                groupName: item.name,
              })}
              onLongPress={() => handleLongPress(item)}
            />
          )}
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

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyText: { fontSize: 15, color: colors.textMuted, marginTop: spacing.md },
});
