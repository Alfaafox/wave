import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, RefreshControl
} from 'react-native';
import { getConversations, startConversation } from '../utils/api';

export default function ChatListScreen({ token, currentUser, onOpenChat, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [starting, setStarting] = useState(false);

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
  }, [loadConversations]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  };

  const handleStartChat = async () => {
    if (!phoneInput.trim()) return;
    setStarting(true);
    try {
      const result = await startConversation(token, phoneInput.trim());
      setModalVisible(false);
      setPhoneInput('');
      await loadConversations();
      onOpenChat(result.conversationId, result.with);
    } catch (err) {
      Alert.alert('Could not start chat', err.message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wave</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logout}>Log out</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No chats yet. Tap + to start one.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => onOpenChat(item.id, item.with)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(item.with?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{item.with?.name || 'Group chat'}</Text>
              <Text style={styles.rowSub}>{item.with?.phone_number || ''}</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
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
  logout: { color: '#fff', fontSize: 14 },
  empty: { textAlign: 'center', marginTop: 60, color: '#999' },
  row: {
    flexDirection: 'row', alignItems: 'center', padding: 14,
    borderBottomWidth: 1, borderBottomColor: '#eee'
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#075E54',
    justifyContent: 'center', alignItems: 'center', marginRight: 12
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 13, color: '#888', marginTop: 2 },
  fab: {
    position: 'absolute', bottom: 30, right: 24, width: 56, height: 56,
    borderRadius: 28, backgroundColor: '#25D366', justifyContent: 'center',
    alignItems: 'center', elevation: 4
  },
  fabText: { color: '#fff', fontSize: 30, marginTop: -2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 14 },
  modalInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  modalCancel: { padding: 12, marginRight: 8 },
  modalConfirm: { backgroundColor: '#075E54', paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8 }
});
