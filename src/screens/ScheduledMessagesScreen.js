// src/screens/ScheduledMessagesScreen.js
//
// Folder view for Scheduled Messages (Phase 4). Lists every message the
// current user has queued for later delivery (GET /scheduled - pending
// only, soonest first) and lets them cancel one before it sends. There is
// no compose screen yet - the native date/time picker this needs is
// deferred to the October rebuild - so today the only way a row lands here
// is via whatever calls POST /scheduled once that compose flow exists.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { getScheduledMessages, cancelScheduledMessage } from '../utils/api';

// SQLite returns UTC timestamps as "YYYY-MM-DD HH:MM:SS" - no 'T', no 'Z'.
// new Date() on that raw string is unreliable (Hermes can mis-parse a
// non-ISO string), so normalise to strict ISO-8601 UTC first - same trick
// ChatScreen.js's parseTs / CallsScreen.js use elsewhere in this codebase.
function parseTs(raw) {
  const s = String(raw || '').replace(' ', 'T');
  const hasTz = s.includes('Z') || /[+-]\d{2}:\d{2}$/.test(s);
  return new Date(hasTz ? s : `${s}Z`);
}

function formatSendAt(raw) {
  const d = parseTs(raw);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${time}`;
  if (isTomorrow) return `Tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

function getConversationLabel(item) {
  if (item.is_group) return item.group_name || 'Group';
  return item.recipient_name || 'Unknown';
}

function messageIcon(type) {
  if (type === 'image') return 'image-outline';
  if (type === 'video') return 'videocam-outline';
  if (type === 'audio') return 'mic-outline';
  if (type === 'location') return 'location-outline';
  return 'chatbubble-outline';
}

function messagePreview(item) {
  if (item.message_type === 'text') return item.content;
  const label = item.message_type === 'image' ? 'Photo'
    : item.message_type === 'video' ? 'Video'
    : item.message_type === 'audio' ? 'Voice message'
    : item.message_type === 'location' ? 'Location'
    : item.message_type;
  return item.caption ? `${label} - ${item.caption}` : label;
}

export default function ScheduledMessagesScreen({ token, onBack }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const data = await getScheduledMessages(token);
      setMessages(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load scheduled messages');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handleCancel = (item) => {
    Alert.alert(
      'Cancel scheduled message?',
      `This message to ${getConversationLabel(item)} will not be sent.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel message',
          style: 'destructive',
          onPress: async () => {
            const prev = messages;
            setMessages((cur) => cur.filter((m) => m.id !== item.id));
            try {
              await cancelScheduledMessage(token, item.id);
            } catch (err) {
              setMessages(prev);
              Alert.alert('Could not cancel', err.message);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => (
    <View style={styles.item}>
      <View style={styles.itemLeft}>
        <View style={styles.iconCircle}>
          <Ionicons name={messageIcon(item.message_type)} size={18} color={colors.accent} />
        </View>
        <View style={styles.itemContent}>
          <Text style={styles.recipientText} numberOfLines={1}>
            {getConversationLabel(item)}
          </Text>
          <Text style={styles.messagePreview} numberOfLines={2}>
            {messagePreview(item)}
          </Text>
          <View style={styles.timeRow}>
            <Ionicons name="time-outline" size={12} color={colors.textMuted} />
            <Text style={styles.timeText}>{formatSendAt(item.send_at)}</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={() => handleCancel(item)} style={styles.cancelBtn} hitSlop={8}>
        <Ionicons name="close-circle-outline" size={24} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scheduled Messages</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="warning-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{error}</Text>
          <TouchableOpacity onPress={() => load()}>
            <Text style={styles.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="time-outline" size={44} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No scheduled messages</Text>
          <Text style={styles.emptySub}>
            Messages you schedule will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: spacing.xl }}
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
  headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 18, fontWeight: '600' },

  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  iconCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.accent + '20',
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  itemContent: { flex: 1 },
  recipientText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  messagePreview: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 12, color: colors.textMuted, marginLeft: 4 },
  cancelBtn: { paddingLeft: spacing.md },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  emptySub: { fontSize: 13, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  retry: { fontSize: 14, color: colors.accent, fontWeight: '600', marginTop: spacing.md },
});
