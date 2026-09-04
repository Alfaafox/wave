import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, RefreshControl
} from 'react-native';
import { getConversations, startConversation, createGroup, deleteConversation } from '../utils/api';
import { connectSocket } from '../utils/socket';
import { colors, spacing, radii, typography, shadow } from '../theme';
import ContactPickerScreen from './ContactPickerScreen';

function previewText(lastMessage) {
  if (!lastMessage) return 'No messages yet';
  if (lastMessage.message_type === 'image') return '📷 Photo';
  if (lastMessage.message_type === 'audio') return '🎤 Voice message';
  return lastMessage.content;
}

export default function ChatListScreen({ token, currentUser, onOpenChat, onLogout, onOpenProfile }) {
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [onlineIds, setOnlineIds] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);

  const [pickerMode, setPickerMode] = useState(null);
  const [groupNamingFor, setGroupNamingFor] = useState(null);
  const [groupNameInput, setGroupNameInput] = useState('');

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations(token);
      setConversations(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }, [token]);

  useEffect(() => {
    loadConversations();
    const socket = connectSocket(token);
    const handlePresence = ({ userId, online }) => {
      setOnlineIds((prev) => ({ ...prev, [userId]: online }));
    };
    const refreshOnActivity = () => loadConversations();

    socket.on('presence', handlePresence);
    socket.on('message', refreshOnActivity);
    socket.on('read', refreshOnActivity);
    socket.on('delivered', refreshOnActivity);
    socket.on('conversationActivity', refreshOnActivity);

    return () => {
      socket.off('presence', handlePresence);
      socket.off('message', refreshOnActivity);
      socket.off('read', refreshOnActivity);
      socket.off('delivered', refreshOnActivity);
      socket.off('conversationActivity', refreshOnActivity);
    };
  }, [loadConversations, token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  };

  const openChatPicker = () => {
    setComposeOpen(false);
    setPickerMode('chat');
  };

  const openGroupPicker = () => {
    setComposeOpen(false);
    setPickerMode('group');
  };

  const closePicker = () => {
    setPickerMode(null);
  };

  const handlePickedUserForChat = async (user) => {
    if (!user.phone) {
      Alert.alert('Missing phone number', 'This contact has no phone number on record.');
      return;
    }
    setPickerMode(null);
    setStarting(true);
    try {
      const result = await startConversation(token, user.phone);
      await loadConversations();
      onOpenChat({ conversationId: result.conversationId, otherUser: result.with, isGroup: false });
    } catch (err) {
      Alert.alert('Could not start chat', err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleGroupSelectionConfirmed = (selectedUsers) => {
    setPickerMode(null);
    setGroupNamingFor(selectedUsers);
    setGroupNameInput('');
  };

  const handleCreateGroupFromPicker = async () => {
    if (!groupNameInput.trim() || !groupNamingFor || groupNamingFor.length === 0) return;
    setStarting(true);
    try {
      const phones = groupNamingFor.map((u) => u.phone).filter(Boolean);
      if (phones.length === 0) {
        Alert.alert('No valid numbers', 'None of the selected contacts have a phone number on record.');
        setStarting(false);
        return;
      }
      const result = await createGroup(token, groupNameInput.trim(), phones);
      setGroupNamingFor(null);
      await loadConversations();
      onOpenChat({ conversationId: result.conversationId, isGroup: true, groupName: result.name });
    } catch (err) {
      Alert.alert('Could not create group', err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleDeleteChat = (item) => {
    const title = item.is_group ? item.name : item.with?.name;
    Alert.alert(
      'Delete chat',
      `Remove this chat with ${title}? This only deletes it for you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversation(token, item.id);
              await loadConversations();
            } catch (err) {
              Alert.alert('Could not delete chat', err.message);
            }
          }
        }
      ]
    );
  };

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((item) => {
      const title = item.is_group ? item.name : item.with?.name;
      return (title || '').toLowerCase().includes(q);
    });
  }, [conversations, searchQuery]);

  if (pickerMode) {
    return (
      <ContactPickerScreen
        token={token}
        mode={pickerMode}
        onClose={closePicker}
        onSelectUser={handlePickedUserForChat}
        onConfirmSelection={handleGroupSelectionConfirmed}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wave</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={onOpenProfile} style={styles.headerIconBtn}>
            <View style={styles.headerAvatar}>
              <Text style={styles.headerAvatarText}>
                {(currentUser?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={styles.headerIconBtn}>
            <Text style={styles.headerActionIcon}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searchQuery ? 'No chats match your search' : 'No chats yet. Tap + to start one.'}
          </Text>
        }
        renderItem={({ item }) => {
          const isGroup = !!item.is_group;
          const title = isGroup ? item.name : item.with?.name;
          const online = !isGroup && item.with && onlineIds[item.with.id];
          const hasUnread = item.unreadCount > 0;

          return (
            <TouchableOpacity
              activeOpacity={0.6}
              style={styles.row}
              onPress={() => onOpenChat({
                conversationId: item.id,
                otherUser: item.with,
                isGroup,
                groupName: item.name
              })}
              onLongPress={() => handleDeleteChat(item)}
            >
              <View>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(title || '?').charAt(0).toUpperCase()}</Text>
                </View>
                {online && <View style={styles.onlineDot} />}
              </View>
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
                  <Text
                    style={[styles.rowSub, hasUnread && styles.rowSubUnread]}
                    numberOfLines={1}
                  >
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
        }}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setComposeOpen(true)} activeOpacity={0.85}>
        <Text style={styles.fabText}>✎</Text>
      </TouchableOpacity>

      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <TouchableOpacity style={styles.composeOverlay} activeOpacity={1} onPress={() => setComposeOpen(false)}>
          <View style={styles.composeSheet}>
            <TouchableOpacity style={styles.composeItem} onPress={openChatPicker}>
              <Text style={styles.composeIcon}>💬</Text>
              <Text style={styles.composeText}>New chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.composeItem} onPress={openGroupPicker}>
              <Text style={styles.composeIcon}>👥</Text>
              <Text style={styles.composeText}>New group</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!groupNamingFor} transparent animationType="slide" onRequestClose={() => setGroupNamingFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Name your group</Text>
            <Text style={styles.modalSubtitle}>
              {groupNamingFor?.length || 0} member{(groupNamingFor?.length || 0) === 1 ? '' : 's'} selected
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              value={groupNameInput}
              onChangeText={setGroupNameInput}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setGroupNamingFor(null)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateGroupFromPicker} style={styles.modalConfirm} disabled={starting}>
                <Text style={styles.modalConfirmText}>{starting ? 'Creating...' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.sm,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  headerTitle: { ...typography.headerTitle, color: colors.textPrimary },
  headerIconBtn: { marginLeft: spacing.md, padding: 2 },
  headerActionIcon: { fontSize: 22, color: colors.textSecondary },
  headerAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  headerAvatarText: { color: colors.textOnAccent, fontSize: 14, fontWeight: '700' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    borderRadius: radii.pill, paddingHorizontal: spacing.md, height: 40
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm, opacity: 0.5 },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  empty: { textAlign: 'center', marginTop: 60, color: colors.textMuted },

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
    position: 'absolute', bottom: 0, right: 0, width: 13, height: 13,
    borderRadius: 7, backgroundColor: colors.online, borderWidth: 2, borderColor: colors.background
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

  fab: {
    position: 'absolute', bottom: 28, right: 20, width: 56, height: 56,
    borderRadius: 28, backgroundColor: colors.accent, justifyContent: 'center',
    alignItems: 'center', ...shadow.md
  },
  fabText: { color: colors.textOnAccent, fontSize: 22 },

  composeOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  composeSheet: {
    backgroundColor: colors.background, margin: spacing.lg, marginBottom: 100,
    borderRadius: radii.md, paddingVertical: spacing.sm, ...shadow.md
  },
  composeItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.lg },
  composeIcon: { fontSize: 18, marginRight: spacing.md },
  composeText: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: colors.background, padding: spacing.lg,
    borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4, color: colors.textPrimary },
  modalSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  modalInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.lg },
  modalCancel: { padding: spacing.md, marginRight: spacing.sm },
  modalCancelText: { color: colors.textSecondary, fontWeight: '500' },
  modalConfirm: {
    backgroundColor: colors.accent, paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl, borderRadius: radii.sm
  },
  modalConfirmText: { color: colors.textOnAccent, fontWeight: '600' }
});
