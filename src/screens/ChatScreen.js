import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Image, Alert
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { getMessages } from '../utils/api';
import { connectSocket } from '../utils/socket';

export default function ChatScreen({ token, currentUser, conversationId, otherUser, isGroup, groupName, onBack }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const listRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    getMessages(token, conversationId).then((data) => {
      if (isMounted) setMessages(data);
    });

    const socket = connectSocket(token);
    socketRef.current = socket;
    socket.emit('joinConversation', conversationId);

    const handleMessage = (msg) => {
      if (msg.conversationId === conversationId) {
        setMessages((prev) => [...prev, msg]);
        setIsOtherTyping(false);
      }
    };

    const handleTyping = ({ conversationId: cid, userId }) => {
      if (cid === conversationId && userId !== currentUser.id) {
        setIsOtherTyping(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
      }
    };

    const handlePresence = ({ userId, online }) => {
      if (!isGroup && otherUser && userId === otherUser.id) {
        setIsOnline(online);
      }
    };

    socket.on('message', handleMessage);
    socket.on('typing', handleTyping);
    socket.on('presence', handlePresence);

    return () => {
      isMounted = false;
      socket.off('message', handleMessage);
      socket.off('typing', handleTyping);
      socket.off('presence', handlePresence);
      clearTimeout(typingTimeoutRef.current);
    };
  }, [conversationId, token]);

  const sendMessage = (content = input, messageType = 'text') => {
    if (!content.trim() && messageType === 'text') return;
    if (!socketRef.current) return;
    socketRef.current.emit('message', { conversationId, content, messageType });
    if (messageType === 'text') setInput('');
  };

  const handleTypingInput = (text) => {
    setInput(text);
    socketRef.current?.emit('typing', { conversationId });
  };

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need access to your photos to send images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.5,
        base64: true,
        allowsEditing: false
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Error', 'Could not read the selected image. Try a different one.');
        return;
      }

      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      sendMessage(dataUri, 'image');
    } catch (err) {
      Alert.alert('Error picking image', err.message);
    }
  };

  const saveImage = async (uri) => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need permission to save photos.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'Image saved to your gallery.');
    } catch (err) {
      Alert.alert('Could not save image', err.message);
    }
  };

  const headerTitle = isGroup ? (groupName || 'Group') : (otherUser?.name || 'Chat');
  const headerSubtitle = isGroup
    ? null
    : (isOtherTyping ? 'typing...' : isOnline ? 'Online' : otherUser?.last_seen ? `Last seen ${new Date(otherUser.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#ECE5DD' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          {!!headerSubtitle && <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMine = item.user_id === currentUser.id;
          return (
            <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {isGroup && !isMine && <Text style={styles.senderName}>{item.username}</Text>}
              {item.message_type === 'image' ? (
                <TouchableOpacity onLongPress={() => saveImage(item.content)}>
                  <Image source={{ uri: item.content }} style={styles.messageImage} resizeMode="cover" />
                  <Text style={styles.saveHint}>Long-press to save</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.bubbleText}>{item.content}</Text>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.bubbleTime}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {isMine && (
                  <Text style={styles.tick}>{item.delivered ? '✓✓' : '✓'}</Text>
                )}
              </View>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.attachButton} onPress={pickImage}>
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          value={input}
          onChangeText={handleTypingInput}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50,
    backgroundColor: '#075E54'
  },
  backArrow: { color: '#fff', fontSize: 22, marginRight: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  headerSubtitle: { color: '#DCF8C6', fontSize: 12, marginTop: 2 },
  bubble: { maxWidth: '75%', borderRadius: 10, padding: 10, marginBottom: 8 },
  bubbleMine: { backgroundColor: '#DCF8C6', alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: '#fff', alignSelf: 'flex-start' },
  senderName: { fontSize: 12, fontWeight: '700', color: '#075E54', marginBottom: 2 },
  bubbleText: { fontSize: 15 },
  messageImage: { width: 200, height: 200, borderRadius: 8 },
  saveHint: { fontSize: 10, color: '#999', marginTop: 2, textAlign: 'center' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  bubbleTime: { fontSize: 10, color: '#888', marginRight: 4 },
  tick: { fontSize: 12, color: '#4FC3F7' },
  inputRow: {
    flexDirection: 'row', padding: 10, backgroundColor: '#fff',
    alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#eee'
  },
  attachButton: { padding: 8, marginRight: 4 },
  attachIcon: { fontSize: 22 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, maxHeight: 100
  },
  sendButton: {
    backgroundColor: '#075E54', borderRadius: 20, paddingHorizontal: 18,
    paddingVertical: 12, justifyContent: 'center'
  }
});
