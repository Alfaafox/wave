import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, RefreshControl
} from 'react-native';
import { getConversations, startConversation, createGroup, deleteConversation } from '../utils/api';
import { connectSocket } from '../utils/socket';

function previewText(lastMessage) {
  if (!lastMessage) return 'No messages yet';
  if (lastMessage.message_type === 'image') return '📷 Photo';
  if (lastMessage.message_type === 'audio') return '🎤 Voice message';
  return lastMessage.content;
}

export default function ChatListScreen({ token, currentUser, onOpenChat, onLogout, onOpenProfile }) {
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [mode, setMode] = useState('chat');
  const [phoneInput, setPhoneInput] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupPhones, setGroupPhones] = useState('');
  const [starting, setStarting] = useState(false);
  const [onlineIds, setOnlineIds] = useState({});

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

    return () => {
      socket.off('presence', handlePresence);
      socket.off('message', refreshOnActivity);
      socket.off('read', refreshOnActivity);
      socket.off('delivered', refreshOnActivity);
    };
  }, [loadConversations, token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  };

  const openStartChatModal = () => {
    setMode('chat');
    setPhoneInput('');
    setModalVisible(true);
  };

  const openGroupModal = () => {
    setMode('group');
    setGroupName('');
    setGroupPhones('');
    setModalVisible(true);
  };

  const handleStartChat = async () => {
    if (!phoneInput.trim()) return;
    setStarting(true);
    try {
      const result = await startConversation(token, phoneInput.trim());
      setModalVisible(false);
      await loadConversations();
      onOpenChat({ conversationId: result.conversationId, otherUser: result.with, isGroup: false });
    } catch (err) {
      Alert.alert('Could not start chat', err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !groupPhones.trim()) return;
    const phones = groupPhones.split(',').map((p) => p.trim()).filter(Boolean);
    setStarting(true);
    try {
      const result = await createGroup(token, groupName.trim(), phones);
      setModalVisible(false);
      await loadConversations();
      if (result.notFound?.length) {
        Alert.alert('Some numbers not found', `Not registered: ${result.notFound.join(', ')}`);
      }
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wave</Text>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={onOpenProfile} style={{ marginRight: 16 }}>
            <Text style={styles.headerAction}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.headerAction}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No chats yet. Tap + to start one.</Text>
        }
        renderItem={({ item }) => {
          const isGroup = !!item.is_group;
          const title = isGroup ? item.name : item.with?.name;
          const online = !isGroup && item.with && onlineIds[item.with.id];
          const hasUnread = item.unreadCount > 0;

          return (
            <TouchableOpacity
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
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{title || 'Chat'}</Text>
                <Text
                  style={[styles.rowSub, hasUnread && styles.rowSubUnread]}
                  numberOfLines={1}
                >
                  {previewText(item.lastMessage)}
                </Text>
              </View>
              {hasUnread && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <Text style={styles.hint}>Tip: long-press a chat to delete it</Text>

      <TouchableOpacity style={styles.fabSecondary} onPress={openGroupModal}>
        <Text style={styles.fabSecondaryText}>Group</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.fab} onPress={openStartChatModal}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            {mode === 'chat' ? (
              <>
                <Text style={styles.modalTitle}>Start a new chat</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Enter phone number (e.g. +911234567890)"
                  keyboardType="phone-pad"
                  value={phoneInput}
                  onChangeText={setPhoneInput}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCancel}>
                    <Text>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleStartChat} style={styles.modalConfirm} disabled={starting}>
                    <Text style={{ color: '#fff' }}>{starting ? 'Starting...' : 'Start'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Create a group</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Group name"
                  value={groupName}
                  onChangeText={setGroupName}
                />
                <TextInput
                  style={[styles.modalInput, { marginTop: 10 }]}
                  placeholder="Phone numbers, comma separated"
                  value={groupPhones}
                  onChangeText={setGroupPhones}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCancel}>
                    <Text>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleCreateGroup} style={styles.modalConfirm} disabled={starting}>
                    <Text style={{ color: '#fff' }}>{starting ? 'Creating...' : 'Create'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, paddingTop: 50, backgroundColor: '#075E54'
  },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerAction: { color: '#fff', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 60, color: '#999' },
  hint: { textAlign: 'center', color: '#aaa', fontSize: 11, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee'
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#075E54',
    justifyContent: 'center', alignItems: 'center', marginRight: 12
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  onlineDot: {
    position: 'absolute', bottom: 0, right: 10, width: 12, height: 12,
    borderRadius: 6, backgroundColor: '#25D366', borderWidth: 2, borderColor: '#fff'
  },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, color: '#888', marginTop: 2 },
  rowSubUnread: { color: '#111', fontWeight: '600' },
  unreadBadge: {
    backgroundColor: '#25D366', borderRadius: 12, minWidth: 22, height: 22,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6, marginLeft: 8
  },
  unreadBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  fab: {
    position: 'absolute', bottom: 30, right: 24, width: 56, height: 56,
    borderRadius: 28, backgroundColor: '#25D366', justifyContent: 'center',
    alignItems: 'center', elevation: 4
  },
  fabText: { color: '#fff', fontSize: 30, marginTop: -2 },
  fabSecondary: {
    position: 'absolute', bottom: 40, right: 96, backgroundColor: '#128C7E',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, elevation: 4
  },
  fabSecondaryText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 14 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalCancel: { padding: 12, marginRight: 8 },
  modalConfirm: { backgroundColor: '#075E54', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 }
});
