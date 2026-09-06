import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Image, Alert, ActivityIndicator,
  Modal, Clipboard, Animated, Keyboard
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioModule, RecordingPresets, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus
} from 'expo-audio';
import { getMessages, getConversations, SERVER_URL } from '../utils/api';
import { connectSocket } from '../utils/socket';
import { ReactionPicker, ReactionPills } from '../components/MessageReactions';
import MediaPickerSheet from '../components/MediaPickerSheet';
import ImageViewerModal from '../components/ImageViewerModal';
import { colors, spacing, radii, typography, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { WALLPAPER_STORAGE_KEY, AUTOSAVE_STORAGE_KEY, getWallpaperColor } from '../utils/chatPreferences';

const EDIT_DELETE_WINDOW_MS = 15 * 60 * 1000;


function AudioBubble({ uri, isMine }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) { player.pause(); } else { player.seekTo(0); player.play(); }
  };
  return (
    <TouchableOpacity style={styles.audioRow} onPress={toggle}>
      <Ionicons
        name={status.playing ? 'pause' : 'play'}
        size={20}
        color={isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText}
        style={styles.audioIcon}
      />
      <Text style={[styles.audioLabel, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
        Voice message
      </Text>
    </TouchableOpacity>
  );
}

export default function ChatScreen({ token, currentUser, conversationId, otherUser, isGroup, groupName, onBack, onStartCall }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [sendingImage, setSendingImage] = useState(false);
  const [sendingCameraImage, setSendingCameraImage] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [actionMenuFor, setActionMenuFor] = useState(null);
  const [forwardPickerFor, setForwardPickerFor] = useState(null);
  const [forwardTargets, setForwardTargets] = useState([]);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const [viewerImage, setViewerImage] = useState(null);
  const [savingViewerImage, setSavingViewerImage] = useState(false);
  const [wallpaperColor, setWallpaperColor] = useState(null);
  const autoSaveRef = useRef(false);
  const listRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

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
    (async () => {
      const [savedWallpaper, savedAutoSave] = await Promise.all([
        AsyncStorage.getItem(WALLPAPER_STORAGE_KEY),
        AsyncStorage.getItem(AUTOSAVE_STORAGE_KEY),
      ]);
      setWallpaperColor(getWallpaperColor(savedWallpaper));
      autoSaveRef.current = savedAutoSave === 'true';
    })();
  }, []);

  useEffect(() => {
    if (recorderState.isRecording) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorderState.isRecording]);

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

        if (autoSaveRef.current && msg.message_type === 'image' && msg.user_id !== currentUser.id) {
          MediaLibrary.saveToLibraryAsync(msg.content).catch((err) => {
            console.warn('Auto-save failed:', err.message);
          });
        }
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

    const payload = { conversationId, content, messageType };
    if (replyTo) payload.replyToId = replyTo.id;

    socketRef.current.emit('message', payload, (response) => {
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

  const formatDuration = (ms) => {
    const totalSec = Math.floor((ms || 0) / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const insertEmoji = (emoji) => setInput((prev) => prev + emoji);

  // GIFs and stickers are both just image URLs as far as this app's message
  // schema and rendering are concerned (see the message_type === 'image'
  // branch in the FlatList renderItem below) - so picking one just sends it
  // as a normal image message. No backend/db schema change needed for this.
  const handlePickMedia = (url) => {
    sendMessage(url, 'image');
    setShowEmojiBar(false);
  };

  const processAndSendImage = async (asset) => {
    if (!asset?.base64) {
      Alert.alert('Error', 'Could not read the image.');
      return;
    }
    const dataUri = `data:image/jpeg;base64,${asset.base64}`;
    const approxKb = Math.round((dataUri.length * 0.75) / 1024);
    if (approxKb > 3000) {
      Alert.alert('Image too large', `About ${approxKb}KB. Try a smaller photo.`);
      return;
    }
    sendMessage(dataUri, 'image');
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
      setSendingImage(true);
      await processAndSendImage(result.assets?.[0]);
      setSendingImage(false);
    } catch (err) {
      setSendingImage(false);
      Alert.alert('Error picking image', err.message);
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.3, base64: true, allowsEditing: false
      });
      if (result.canceled) return;
      setSendingCameraImage(true);
      await processAndSendImage(result.assets?.[0]);
      setSendingCameraImage(false);
    } catch (err) {
      setSendingCameraImage(false);
      Alert.alert('Error taking photo', err.message);
    }
  };

  const saveImage = async (uri) => {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need permission to save photos.');
        return;
      }
      // MediaLibrary needs a real local file with a proper extension - it
      // cannot save a base64 data URI or a remote https URL directly (this
      // is the actual cause of the "Could not get the file's extension"
      // error). Own photos/camera shots arrive as data URIs; GIFs/stickers
      // arrive as remote URLs (see MediaPickerSheet) - both need to become
      // a real local file first.
      let localUri = uri;

      if (uri.startsWith('data:')) {
        const match = uri.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!match) throw new Error('Unrecognized image data');
        const [, ext, base64Data] = match;
        const tempPath = `${FileSystem.cacheDirectory}wave_save_${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(tempPath, base64Data, { encoding: FileSystem.EncodingType.Base64 });
        localUri = tempPath;
      } else if (uri.startsWith('http://') || uri.startsWith('https://')) {
        const cleanPath = uri.split('?')[0];
        const ext = cleanPath.split('.').pop() || 'gif';
        const tempPath = `${FileSystem.cacheDirectory}wave_save_${Date.now()}.${ext}`;
        const downloadResult = await FileSystem.downloadAsync(uri, tempPath);
        localUri = downloadResult.uri;
      }

      await MediaLibrary.saveToLibraryAsync(localUri);
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
      style={{ flex: 1, backgroundColor: wallpaperColor || colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
          {!!headerSubtitle && <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>}
        </View>
        {!isGroup && otherUser && onStartCall && (
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'audio')} style={styles.headerIconBtn}>
              <Ionicons name="call-outline" size={22} color={colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onStartCall(otherUser.id, otherUser.name, 'video')} style={styles.headerIconBtn}>
              <Ionicons name="videocam-outline" size={24} color={colors.accent} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: spacing.md }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => {
          const isMine = item.user_id === currentUser.id;

          if (item.deleted_for_everyone) {
            return (
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="ban-outline" size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
                  <Text style={styles.deletedText}>This message was deleted</Text>
                </View>
              </View>
            );
          }

          return (
            <TouchableOpacity
              activeOpacity={0.85}
              onLongPress={() => openActionMenu(item)}
              style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}
            >
              {isGroup && !isMine && <Text style={styles.senderName}>{item.username}</Text>}

              {item.reply_to_id && (
                <View style={styles.replyPreview}>
                  <Text style={styles.replyPreviewName}>{item.reply_username}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {item.reply_type === 'image' && <Ionicons name="camera-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />}
                    {item.reply_type === 'audio' && <Ionicons name="mic-outline" size={12} color={colors.textSecondary} style={{ marginRight: 4 }} />}
                    <Text style={styles.replyPreviewText} numberOfLines={1}>
                      {item.reply_type === 'image' ? 'Photo' : item.reply_type === 'audio' ? 'Voice message' : item.reply_content}
                    </Text>
                  </View>
                </View>
              )}

              {item.message_type === 'image' && (
                <TouchableOpacity onPress={() => setViewerImage(item.content)} onLongPress={() => openActionMenu(item)}>
                  <Image source={{ uri: item.content }} style={styles.messageImage} resizeMode="cover" />
                </TouchableOpacity>
              )}
              {item.message_type === 'audio' && <AudioBubble uri={item.content} isMine={isMine} />}
              {item.message_type === 'text' && (
                <Text style={[styles.bubbleText, { color: isMine ? colors.bubbleOutgoingText : colors.bubbleIncomingText }]}>
                  {item.content}
                </Text>
              )}

              <View style={styles.metaRow}>
                {item.edited === 1 && (
                  <Text style={[styles.editedLabel, { color: isMine ? 'rgba(255,255,255,0.6)' : colors.textMuted }]}>edited</Text>
                )}
                <Text style={[styles.bubbleTime, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textMuted }]}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                {isMine && (
                  <Ionicons
                    name={item.delivered ? 'checkmark-done' : 'checkmark'}
                    size={14}
                    color={item.read ? '#8FD3FF' : 'rgba(255,255,255,0.7)'}
                  />
                )}
              </View>
              <ReactionPills
                reactions={item.reactions}
                currentUserId={currentUser.id}
                onPress={(emoji) => handleToggleReaction(item.id, emoji)}
                onLongPress={(reaction) => Alert.alert('Reacted', `${reaction.emoji} x ${reaction.count}`)}
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
              {replyTo.message_type === 'image' ? 'Photo' : replyTo.message_type === 'audio' ? 'Voice message' : replyTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Ionicons name="close" size={18} color={colors.textMuted} style={{ paddingHorizontal: spacing.sm }} />
          </TouchableOpacity>
        </View>
      )}

      {editingMessage && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName}>Editing message</Text>
          </View>
          <TouchableOpacity onPress={cancelEdit}>
            <Ionicons name="close" size={18} color={colors.textMuted} style={{ paddingHorizontal: spacing.sm }} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputRow}>
        <TouchableOpacity
          style={styles.emojiButton}
          onPress={() => {
            const next = !showEmojiBar;
            setShowEmojiBar(next);
            if (next) Keyboard.dismiss();
          }}
        >
          <Ionicons name="happy-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          placeholder="Type a message"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={handleTypingInput}
          onFocus={() => setShowEmojiBar(false)}
          multiline
        />

        <TouchableOpacity style={styles.attachButton} onPress={takePhoto} disabled={sendingCameraImage}>
          {sendingCameraImage ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="camera-outline" size={23} color={colors.textSecondary} />}
        </TouchableOpacity>

        <TouchableOpacity style={styles.attachButton} onPress={pickImage} disabled={sendingImage}>
          {sendingImage ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="attach-outline" size={23} color={colors.textSecondary} />}
        </TouchableOpacity>

        {editingMessage ? (
          <TouchableOpacity style={styles.sendButton} onPress={submitEdit}>
            <Text style={styles.sendButtonText}>Save</Text>
          </TouchableOpacity>
        ) : input.trim().length === 0 ? (
          <TouchableOpacity
            style={styles.micButton}
            onPressIn={startRecording}
            onPressOut={stopRecordingAndSend}
          >
            <Animated.View style={[
              styles.micPulse,
              recorderState.isRecording && { transform: [{ scale: pulseAnim }], backgroundColor: colors.recordingPulse }
            ]}>
              <Ionicons name={recorderState.isRecording ? 'stop' : 'mic'} size={20} color={colors.textOnAccent} />
            </Animated.View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.sendButtonRound} onPress={() => sendMessage()}>
            <Ionicons name="send" size={18} color={colors.textOnAccent} />
          </TouchableOpacity>
        )}
      </View>

      <MediaPickerSheet
        visible={showEmojiBar}
        token={token}
        serverUrl={SERVER_URL}
        onInsertEmoji={insertEmoji}
        onPickMedia={handlePickMedia}
        onRequestClose={() => setShowEmojiBar(false)}
      />

      {recorderState.isRecording && (
        <View style={styles.recordingBanner}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Animated.View style={[styles.recDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.recordingText}>Recording {formatDuration(recorderState.durationMillis)} - release to send</Text>
          </View>
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
            {actionMenuFor?.message_type === 'image' && (
              <TouchableOpacity style={styles.actionItem} onPress={() => { const msg = actionMenuFor; closeActionMenu(); saveImage(msg.content); }}>
                <Text style={styles.actionText}>Save to Gallery</Text>
              </TouchableOpacity>
            )}
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
              <Text style={[styles.actionText, { color: colors.danger }]}>Delete</Text>
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

      <ImageViewerModal
        visible={!!viewerImage}
        uri={viewerImage}
        saving={savingViewerImage}
        onClose={() => setViewerImage(null)}
        onSave={async () => {
          setSavingViewerImage(true);
          await saveImage(viewerImage);
          setSavingViewerImage(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  backArrow: { color: colors.textPrimary, fontSize: 22 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '600' },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  headerIconBtn: { marginLeft: spacing.md, padding: 2 },
  headerIcon: { fontSize: 20 },

  bubble: { maxWidth: '78%', borderRadius: radii.bubble, padding: spacing.md, marginBottom: spacing.sm },
  bubbleMine: {
    backgroundColor: colors.bubbleOutgoing, alignSelf: 'flex-end',
    borderBottomRightRadius: radii.bubbleTail
  },
  bubbleTheirs: {
    backgroundColor: colors.bubbleIncoming, alignSelf: 'flex-start',
    borderBottomLeftRadius: radii.bubbleTail
  },
  senderName: { fontSize: 12, fontWeight: '700', color: colors.accent, marginBottom: 2 },
  bubbleText: { ...typography.bubbleText },
  deletedText: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  messageImage: { width: 200, height: 200, borderRadius: radii.sm },
  saveHint: { fontSize: 10, marginTop: 2, textAlign: 'center' },
  audioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, minWidth: 140 },
  audioIcon: { marginRight: spacing.sm },
  audioLabel: { fontSize: 14 },
  replyPreview: {
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: 'rgba(44,107,237,0.08)',
    paddingLeft: spacing.sm, paddingVertical: 4, marginBottom: spacing.sm, borderRadius: 4
  },
  replyPreviewName: { fontSize: 12, fontWeight: '700', color: colors.accent },
  replyPreviewText: { fontSize: 12, color: colors.textSecondary },
  metaRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 },
  editedLabel: { fontSize: 10, marginRight: 4, fontStyle: 'italic' },
  bubbleTime: { fontSize: 10, marginRight: 4 },

  replyBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border
  },
  replyBarName: { fontSize: 12, fontWeight: '700', color: colors.accent },
  replyBarText: { fontSize: 12, color: colors.textSecondary },

  inputRow: {
    flexDirection: 'row', padding: spacing.sm, backgroundColor: colors.background,
    alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.border
  },
  attachButton: { padding: spacing.sm, marginRight: 2, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  emojiButton: { padding: spacing.sm, marginRight: 2, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginRight: spacing.sm,
    maxHeight: 100, color: colors.textPrimary
  },
  sendButton: {
    backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, justifyContent: 'center'
  },
  sendButtonText: { color: colors.textOnAccent, fontWeight: '600' },
  sendButtonRound: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  micButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  micPulse: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  micIcon: { fontSize: 18 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginRight: 6 },
  recordingBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFF6E5', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm
  },
  recordingText: { color: '#8A6100', fontSize: 13 },
  cancelText: { color: colors.danger, fontSize: 13, fontWeight: '600' },

  actionOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', alignItems: 'center' },
  actionMenu: { backgroundColor: colors.background, borderRadius: radii.md, width: 220, paddingVertical: spacing.sm, ...shadow.md },
  actionItem: { paddingVertical: 14, paddingHorizontal: spacing.xl },
  actionText: { fontSize: 16, color: colors.textPrimary },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  forwardBox: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md, maxHeight: '60%' },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: spacing.md, color: colors.textPrimary },
  forwardRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  forwardRowText: { fontSize: 15, color: colors.textPrimary },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 20 },
  modalCancel: { padding: spacing.md, alignItems: 'center', marginTop: spacing.sm }
});
