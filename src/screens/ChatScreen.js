// src/screens/ChatScreen.js
// The main group chat: shows message history, listens for new messages in
// real time over Socket.io, and lets you send your own.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import { fetchMessages } from '../api';
import { createSocket } from '../socket';

export default function ChatScreen({ token, username, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    // 1. Load recent history over plain REST.
    fetchMessages(token)
      .then((history) => {
        if (isMounted) setMessages(history);
      })
      .catch((err) => console.warn('Failed to load history:', err.message));

    // 2. Open a real-time connection for anything sent from now on.
    const socket = createSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('system', (text) => {
      setMessages((prev) => [
        ...prev,
        { id: `system-${Date.now()}`, system: true, content: text },
      ]);
    });

    return () => {
      isMounted = false;
      socket.disconnect();
    };
  }, [token]);

  function handleSend() {
    const text = draft.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit('message', text);
    setDraft('');
  }

  function renderItem({ item }) {
    if (item.system) {
      return <Text style={styles.systemText}>{item.content}</Text>;
    }
    const isMe = item.username === username;
    return (
      <View
        style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        {!isMe && <Text style={styles.senderName}>{item.username}</Text>}
        <Text style={isMe ? styles.textMine : styles.textTheirs}>
          {item.content}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Group chat</Text>
        <View style={styles.headerRight}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: connected ? '#22c55e' : '#ef4444' },
            ]}
          />
          <TouchableOpacity onPress={onLogout}>
            <Text style={styles.logout}>Log out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item, index) =>
          String(item.id !== undefined ? item.id : index)
        }
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => {
          if (listRef.current) listRef.current.scrollToEnd({ animated: true });
        }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  logout: { color: '#2563eb', fontSize: 14 },
  list: { padding: 12, gap: 8 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 4,
  },
  bubbleMine: {
    backgroundColor: '#2563eb',
    alignSelf: 'flex-end',
  },
  bubbleTheirs: {
    backgroundColor: '#f1f5f9',
    alignSelf: 'flex-start',
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 2,
  },
  textMine: { color: '#fff', fontSize: 15 },
  textTheirs: { color: '#0f172a', fontSize: 15 },
  systemText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 12,
    marginVertical: 6,
  },
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendButtonText: { color: '#fff', fontWeight: '600' },
});
