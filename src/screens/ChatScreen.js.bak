import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Image, Alert, ActivityIndicator,
  Modal, Clipboard
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule, RecordingPresets, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus
} from 'expo-audio';
import { getMessages, getConversations } from '../utils/api';
import { connectSocket } from '../utils/socket';
import { ReactionPicker, ReactionPills } from '../components/MessageReactions';

const EDIT_DELETE_WINDOW_MS = 15 * 60 * 1000;

function AudioBubble({ uri }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) { player.pause(); } else { player.seekTo(0); player.play(); }
  };
  return (
    <TouchableOpacity style={styles.audioRow} onPress={toggle}>
      <Text style={styles.audioIcon}>{status.playing ? '⏸' : '▶️'}</Text>
      <Text style={styles.audioLabel}>Voice message</Text>
    </TouchableOpacity>
  );
}

export default function ChatScreen({ token, currentUser, conversationId, otherUser, isGroup, groupName, onBack, onStartCall }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [actionMenuFor, setActionMenuFor] = useState(null);
  const [forwardPickerFor, setForwardPickerFor] = useState(null);
  const [forwardTargets, setForwardTargets] = useState([]);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const listRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) console.warn('Microphone permission not granted');
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, []);

  useEffect(() => {
    let isMounted = true;

    getMessages(token, conversationId).then((data) => {
      if (isMounted) setMessages(data);
    });

    const socket = connectSocket(token);
    socketRef.current = socket;
    socket.emit('joinConversation', conversationId, (response) => {
      if (!response?.ok) console.warn('Failed to join conversation:', response?.error);
    });

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
      if (!isGroup && otherUser && userId === otherUser.id) setIsOnline(online);
    };
    const handleDelivered = ({ conversationId: cid, messageIds }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, delivered: 1 } : m)));
    };
    const handleRead = ({ conversationId: cid, messageIds }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, read: 1 } : m)));
    };
    const handleEdited = ({ conversationId: cid, messageId, newContent }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, content: newContent, edited: 1 } : m)));
    };
    const handleDeletedForEveryone = ({ conversationId: cid, messageId }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted_for_everyone: 1, content: '' } : m)));
    };
    const handleReactionUpdate = ({ conversationId: cid, messageId, reactions }) => {
      if (cid !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
    };

    socket.on('message', handleMessage);
    socket.on('reactionUpdate', handleReactionUpdate);
    socket.on('typing', handleTyping);
    socket.on('presence', handlePresence);
    socket.on('delivered', handleDelivered);
    socket.on('read', handleRead);
    socket.on('messageEdited', handleEdited);
    socket.on('messageDeletedForEveryone', handleDeletedForEveryone);

    return () => {
      isMounted = false;
      socket.off('message', handleMessage);
      socket.off('typing', handleTyping);
      socket.off('presence', handlePresence);
      socket.off('delivered', handleDelivered);
      socket.off('read', handleRead);
      socket.off('messageEdited', handleEdited);
      socket.off('messageDeletedForEveryone', handleDeletedForEveryone);
      socket.off('reactionUpdate', handleReactionUpdate);
      clearTimeout(typingTimeoutRef.current);
    };
  }, [conversationId, token]);

  const sendMessage = (content = input, messageType = 'text') => {
    if (!content.trim() && messageType === 'text') return;
    if (!socketRef.current) {
      Alert.alert('Not connected', 'Reconnecting... try again in a second.');
      return;
    }
    if (messageType === 'image') setSendingImage(true);

    const payload = { conversationId, content, messageType };
    if (replyTo) payload.replyToId = replyTo.id;

    socketRef.current.emit('message', payload, (response) => {
      if (messageType === 'image') setSendingImage(false);
      if (!response?.ok) {
        Alert.alert('Message failed', response?.error || 'Could not send message. Try again.');
      }
    });

    if (messageType === 'text') setInput('');
    setReplyTo(null);
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
        mediaTypes: ['images'], quality: 0.3, base64: true, allowsEditing: false
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Error', 'Could not read the selected image.');
        return;
      }
      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      const approxKb = Math.round((dataUri.length * 0.75) / 1024);
      if (approxKb > 3000) {
        Alert.alert('Image too large', `About ${approxKb}KB. Try a smaller photo.`);
        return;
      }
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

  const startRecording = async () => {
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (err) {
      Alert.alert('Could not start recording', err.message);
    }
  };

  const stopRecordingAndSend = async () => {
    try {
      if (!recorderState.isRecording) return;
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) return;
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const dataUri = `data:audio/m4a;base64,${base64}`;
      const approxKb = Math.round((dataUri.length * 0.75) / 1024);
      if (approxKb > 4000) {
        Alert.alert('Recording too long', 'Please keep voice messages shorter.');
        return;
      }
      sendMessage(dataUri, 'audio');
    } catch (err) {
      Alert.alert('Could not send recording', err.message);
    }
  };

  const cancelRecording = async () => {
    try {
      if (recorderState.isRecording) await audioRecorder.stop();
    } catch (e) {}
  };

  const openActionMenu = (message) => {
    if (message.deleted_for_everyone) return;
    setActionMenuFor(message);
  };

  const closeActionMenu = () => setActionMenuFor(null);

  const handleReply = () => {
    setReplyTo(actionMenuFor);
    closeActionMenu();
  };

  const handleCopy = () => {
    if (actionMenuFor?.message_type === 'text') {
      Clipboard.setString(actionMenuFor.content);
    }
    closeActionMenu();
  };

  const handleEdit = () => {
    const msg = actionMenuFor;
    const age = Date.now() - new Date(msg.created_at.replace(' ', 'T') + (msg.created_at.includes('Z') ? '' : 'Z')).getTime();
    if (age > EDIT_DELETE_WINDOW_MS) {
      Alert.alert('Too late', 'You can only edit messages within 15 minutes of sending.');
      closeActionMenu();
      return;
    }
    setEditingMessage(msg);
    setInput(msg.content);
    closeActionMenu();
  };

  const handleDeleteForMe = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    socketRef.current?.emit('deleteForMe', { messageId: msg.id }, (response) => {
      if (response?.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        Alert.alert('Error', response?.error || 'Could not delete message');
      }
    });
  };

  const handleDeleteForEveryone = () => {
    const msg = actionMenuFor;
    closeActionMenu();
    socketRef.current?.emit('deleteForEveryone', { messageId: msg.id }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not delete for everyone', response?.error || 'Try again.');
      }
    });
  };

  const confirmDelete = () => {
    const msg = actionMenuFor;
    const isMine = msg.user_id === currentUser.id;
    const age = Date.now() - new Date(msg.created_at.replace(' ', 'T') + (msg.created_at.includes('Z') ? '' : 'Z')).getTime();
    const canDeleteForEveryone = isMine && age <= EDIT_DELETE_WINDOW_MS;

    closeActionMenu();
    const options = [{ text: 'Cancel', style: 'cancel' }];
    if (canDeleteForEveryone) {
      options.push({ text: 'Delete for everyone', style: 'destructive', onPress: () => doDeleteForEveryone(msg) });
    }
    options.push({ text: 'Delete for me', style: 'destructive', onPress: () => doDeleteForMe(msg) });

    Alert.alert('Delete message?', '', options);
  };

  const doDeleteForMe = (msg) => {
    socketRef.current?.emit('deleteForMe', { messageId: msg.id }, (response) => {
      if (response?.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        Alert.alert('Error', response?.error || 'Could not delete message');
      }
    });
  };

  const doDeleteForEveryone = (msg) => {
    socketRef.current?.emit('deleteForEveryone', { messageId: msg.id }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not delete for everyone', response?.error || 'Try again.');
      }
    });
  };

  const handleForward = async () => {
    const msg = actionMenuFor;
    closeActionMenu();
    try {
      const convos = await getConversations(token);
      setForwardTargets(convos.filter((c) => c.id !== conversationId));
      setForwardPickerFor(msg);
    } catch (err) {
      Alert.alert('Error', 'Could not load your chats to forward to.');
    }
  };

  const doForwardTo = (targetConversationId) => {
    const msg = forwardPickerFor;
    setForwardPickerFor(null);
    if (!socketRef.current || !msg) return;
    socketRef.current.emit(
      'message',
      { conversationId: targetConversationId, content: msg.content, messageType: msg.message_type },
      (response) => {
        if (response?.ok) {
          Alert.alert('Forwarded', 'Message forwarded.');
        } else {
          Alert.alert('Error', response?.error || 'Could not forward message');
        }
      }
    );
  };

  const handleToggleReaction = (messageId, emoji) => {
    socketRef.current?.emit('toggleReaction', { messageId, emoji }, (response) => {
      if (!response?.ok) {
        Alert.alert('Error', response?.error || 'Could not react to message');
      }
    });
  };

  const openReactionPicker = () => {
    setReactionPickerFor(actionMenuFor);
    closeActionMenu();
  };

  const submitEdit = () => {
    if (!editingMessage) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    socketRef.current?.emit('editMessage', { messageId: editingMessage.id, newContent: trimmed }, (response) => {
      if (!response?.ok) {
        Alert.alert('Could not edit', response?.error || 'Try again.');
      }
    });
    setEditingMessage(null);
    setInput('');
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setInput('');
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          {!!headerSubtitle && <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>}
        </View>
        {!isGroup && otherUser && onStartCall && (
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'audio')} style={{ marginRight: 16 }}>
              <Text style={{ fontSize: 22 }}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'video')}>
              <Text style={{ fontSize: 22 }}>📹</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMine = item.user_id === currentUser.id;

          if (item.deleted_for_everyone) {
            return (
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.deletedText}>🚫 This message was deleted</Text>
              </View>
            );
          }

          return (
            <TouchableOpacity
              activeOpacity={0.8}
              onLongPress={() => openActionMenu(item)}
              style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}
            >
              {isGroup && !isMine && <Text style={styles.senderName}>{item.username}</Text>}

              {item.reply_to_id && (
                <View style={styles.replyPreview}>
                  <Text style={styles.replyPreviewName}>{item.reply_username}</Text>
                  <Text style={styles.replyPreviewText} numberOfLines={1}>
                    {item.reply_type === 'image' ? '📷 Photo' : item.reply_type === 'audio' ? '🎤 Voice message' : item.reply_content}
                  </Text>
                </View>
              )}

              {item.message_type === 'image' && (
                <TouchableOpacity onPress={() => saveImage(item.content)}>
                  <Image source={{ uri: item.content }} style={styles.messageImage} resizeMode="cover" />
                  <Text style={styles.saveHint}>Tap to save</Text>
                </TouchableOpacity>
              )}
              {item.message_type === 'audio' && <AudioBubble uri={item.content} />}
              {item.message_type === 'text' && <Text style={styles.bubbleText}>{item.content}</Text>}

              <View style={styles.metaRow}>
                {item.edited === 1 && <Text style={styles.editedLabel}>edited</Text>}
                <Text style={styles.bubbleTime}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {isMine && <Text style={[styles.tick, item.read && styles.tickRead]}>{item.delivered ? '✓✓' : '✓'}</Text>}
              </View>
              <ReactionPills
                reactions={item.reactions}
                currentUserId={currentUser.id}
                onPress={(emoji) => handleToggleReaction(item.id, emoji)}
                onLongPress={(reaction) => Alert.alert('Reacted', `${reaction.emoji} × ${reaction.count}`)}
              />
            </TouchableOpacity>
          );
        }}
      />

      {replyTo && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>Replying to {replyTo.username}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {replyTo.message_type === 'image' ? '📷 Photo' : replyTo.message_type === 'audio' ? '🎤 Voice message' : replyTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Text style={styles.replyBarClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {editingMessage && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>Editing message</Text>
          </View>
          <TouchableOpacity onPress={cancelEdit}>
            <Text style={styles.replyBarClose}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.attachButton} onPress={pickImage} disabled={sendingImage}>
          {sendingImage ? <ActivityIndicator size="small" color="#075E54" /> : <Text style={styles.attachIcon}>📎</Text>}
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="Type a message"
          value={input}
          onChangeText={handleTypingInput}
          multiline
        />
        {editingMessage ? (
          <TouchableOpacity style={styles.sendButton} onPress={submitEdit}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
          </TouchableOpacity>
        ) : input.trim().length === 0 ? (
          <TouchableOpacity
            style={[styles.micButton, recorderState.isRecording && styles.micButtonActive]}
            onPressIn={startRecording}
            onPressOut={stopRecordingAndSend}
          >
            <Text style={styles.micIcon}>{recorderState.isRecording ? '⏺' : '🎤'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.sendButton} onPress={() => sendMessage()}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>Send</Text>
          </TouchableOpacity>
        )}
      </View>
      {recorderState.isRecording && (
        <View style={styles.recordingBanner}>
          <Text style={styles.recordingText}>Recording... release to send</Text>
          <TouchableOpacity onPress={cancelRecording}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={!!actionMenuFor} transparent animationType="fade" onRequestClose={closeActionMenu}>
        <TouchableOpacity style={styles.actionOverlay} activeOpacity={1} onPress={closeActionMenu}>
          <View style={styles.actionMenu}>
            <TouchableOpacity style={styles.actionItem} onPress={handleReply}>
              <Text style={styles.actionText}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionItem} onPress={openReactionPicker}>
              <Text style={styles.actionText}>React</Text>
            </TouchableOpacity>
            {actionMenuFor?.message_type === 'text' && (
              <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
                <Text style={styles.actionText}>Copy</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={handleForward}>
              <Text style={styles.actionText}>Forward</Text>
            </TouchableOpacity>
            {actionMenuFor?.user_id === currentUser.id && actionMenuFor?.message_type === 'text' && (
              <TouchableOpacity style={styles.actionItem} onPress={handleEdit}>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actionItem} onPress={confirmDelete}>
              <Text style={[styles.actionText, { color: '#d32f2f' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <ReactionPicker
        visible={!!reactionPickerFor}
        onSelect={(emoji) => handleToggleReaction(reactionPickerFor.id, emoji)}
        onClose={() => setReactionPickerFor(null)}
      />

      <Modal visible={!!forwardPickerFor} transparent animationType="slide" onRequestClose={() => setForwardPickerFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.forwardBox}>
            <Text style={styles.modalTitle}>Forward to...</Text>
            <FlatList
              data={forwardTargets}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => {
                const title = item.is_group ? item.name : item.with?.name;
                return (
                  <TouchableOpacity style={styles.forwardRow} onPress={() => doForwardTo(item.id)}>
                    <Text style={styles.forwardRowText}>{title || 'Chat'}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={styles.empty}>No other chats to forward to</Text>}
            />
            <TouchableOpacity onPress={() => setForwardPickerFor(null)} style={styles.modalCancel}>
              <Text>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  deletedText: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  messageImage: { width: 200, height: 200, borderRadius: 8 },
  saveHint: { fontSize: 10, color: '#999', marginTop: 2, textAlign: 'center' },
  audioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, minWidth: 140 },
  audioIcon: { fontSize: 20, marginRight: 8 },
  audioLabel: { fontSize: 14, color: '#333' },
  replyPreview: {
    borderLeftWidth: 3, borderLeftColor: '#075E54', backgroundColor: 'rgba(7,94,84,0.08)',
    paddingLeft: 8, paddingVertical: 4, marginBottom: 6, borderRadius: 4
  },
  replyPreviewName: { fontSize: 12, fontWeight: '700', color: '#075E54' },
  replyPreviewText: { fontSize: 12, color: '#555' },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  editedLabel: { fontSize: 10, color: '#999', marginRight: 4, fontStyle: 'italic' },
  bubbleTime: { fontSize: 10, color: '#888', marginRight: 4 },
  tick: { fontSize: 12, color: '#888' },
  tickRead: { color: '#4FC3F7' },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0',
    paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#ddd'
  },
  replyBarName: { fontSize: 12, fontWeight: '700', color: '#075E54' },
  replyBarText: { fontSize: 12, color: '#555' },
  replyBarClose: { fontSize: 16, color: '#888', paddingHorizontal: 8 },
  inputRow: {
    flexDirection: 'row', padding: 10, backgroundColor: '#fff',
    alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#eee'
  },
  attachButton: { padding: 8, marginRight: 4, minWidth: 30, alignItems: 'center' },
  attachIcon: { fontSize: 22 },
  input: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 8, maxHeight: 100
  },
  sendButton: {
    backgroundColor: '#075E54', borderRadius: 20, paddingHorizontal: 18,
    paddingVertical: 12, justifyContent: 'center'
  },
  micButton: {
    backgroundColor: '#075E54', borderRadius: 20, width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center'
  },
  micButtonActive: { backgroundColor: '#d32f2f' },
  micIcon: { fontSize: 18 },
  recordingBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff3cd', paddingHorizontal: 16, paddingVertical: 8
  },
  recordingText: { color: '#856404', fontSize: 13 },
  cancelText: { color: '#d32f2f', fontSize: 13, fontWeight: '600' },
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
  actionMenu: { backgroundColor: '#fff', borderRadius: 12, width: 220, paddingVertical: 8 },
  actionItem: { paddingVertical: 14, paddingHorizontal: 20 },
  actionText: { fontSize: 16, color: '#111' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  forwardBox: { backgroundColor: '#fff', padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '60%' },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 14 },
  forwardRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  forwardRowText: { fontSize: 15 },
  empty: { textAlign: 'center', color: '#999', marginTop: 20 },
  modalCancel: { padding: 12, alignItems: 'center', marginTop: 8 }
});
