import React, { useState, useEffect, useCallback } from 'react';
import { View, ActivityIndicator, Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';

import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CallScreen from './src/screens/CallScreen';
import CallsScreen from './src/screens/CallsScreen';
import UpdatesScreen from './src/screens/UpdatesScreen';
import BottomTabBar from './src/components/BottomTabBar';
import SettingsScreen from './src/screens/SettingsScreen';
import AccountSettingsScreen from './src/screens/AccountSettingsScreen';
import PrivacySettingsScreen from './src/screens/PrivacySettingsScreen';
import ChatsSettingsScreen from './src/screens/ChatsSettingsScreen';
import AppearanceSettingsScreen from './src/screens/AppearanceSettingsScreen';
import NotificationsSettingsScreen from './src/screens/NotificationsSettingsScreen';
import InviteFriendScreen from './src/screens/InviteFriendScreen';
import StarredMessagesScreen from './src/screens/StarredMessagesScreen';
import ArchivedChatsScreen from './src/screens/ArchivedChatsScreen';
import NotificationBanner from './src/components/NotificationBanner';
import { colors } from './src/theme';
import { disconnectSocket, connectSocket } from './src/utils/socket';
import { getCurrentUser, getConversations, updateProfilePicture } from './src/utils/api';
import {
  getPermissionStatus,
  hasAskedPermission,
  markAskedPermission,
  requestPermission,
  registerDeviceForPush,
  unregisterDeviceForPush,
} from './src/utils/notifications';

const TAB_SCREENS = ['chatList', 'calls', 'updates'];

export default function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('login');
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [socket, setSocket] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(null);
  const [banner, setBanner] = useState(null);
  // Live presence for everyone who shares a conversation with us, keyed by
  // userId -> { online: bool, lastSeen: ISO string | null }. Fed by the
  // server's presence:online / presence:offline events (incl. a one-time
  // snapshot of who's already online, sent on connect). Lives here because
  // ChatScreen needs it correct on mount and the chat list unmounts often.
  const [presenceMap, setPresenceMap] = useState(() => new Map());

  useEffect(() => {
    (async () => {
      try {
        const savedToken = await AsyncStorage.getItem('token');
        const savedUser = await AsyncStorage.getItem('user');
        if (savedToken && savedUser) {
          setToken(savedToken);
          setCurrentUser(JSON.parse(savedUser));
          setScreen('chatList');

          getCurrentUser(savedToken).then((freshUser) => {
            const normalized = {
              id: freshUser.id,
              name: freshUser.name,
              email: freshUser.email,
              phoneNumber: freshUser.phone_number,
              profilePicture: freshUser.profile_picture,
              username: freshUser.username || null
            };
            setCurrentUser(normalized);
            AsyncStorage.setItem('user', JSON.stringify(normalized));
          }).catch((err) => {
            // If this device still has a token for an account that was
            // deactivated or deleted (e.g. from another device), drop the
            // stale session instead of showing a dead chat list.
            if (/deactivat|no longer exists/i.test(err.message || '')) {
              handleLogout();
            } else {
              console.warn('Could not refresh profile at launch:', err.message);
            }
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      setPresenceMap(new Map());
      return;
    }
    const s = connectSocket(token);
    setSocket(s);
    const handleIncomingCall = ({ callId, fromUserId, fromName, callType }) => {
      setIncomingCall({ mode: 'incoming', callId, fromUserId, fromName, callType });
      // Call glare: if we're mid-outgoing-call to this exact person, their
      // invite crossed ours and the server let it win. Drop our outgoing
      // attempt now so the two full-screen CallScreens never render stacked -
      // callManager's own glare branch (via the invite ack) also closes it,
      // this just removes the brief window before that ack arrives.
      setOutgoingCall((cur) => (cur && cur.targetUserId === fromUserId ? null : cur));
    };
    const handleProfileUpdatedFromSocket = (freshUser) => {
      setCurrentUser(freshUser);
      AsyncStorage.setItem('user', JSON.stringify(freshUser));
    };
    const handlePresenceOnline = ({ userId }) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(userId, { online: true, lastSeen: prev.get(userId)?.lastSeen || null });
        return next;
      });
    };
    // Sent once on (re)connect: the authoritative set of co-members online
    // right now. Rebuild from it so a reconnect can't leave someone stuck
    // "online" after they left during our disconnect window.
    const handlePresenceSync = ({ online }) => {
      const onlineSet = new Set(Array.isArray(online) ? online : []);
      setPresenceMap((prev) => {
        const next = new Map();
        onlineSet.forEach((id) => next.set(id, { online: true, lastSeen: prev.get(id)?.lastSeen || null }));
        prev.forEach((v, id) => {
          if (!onlineSet.has(id)) next.set(id, { online: false, lastSeen: v.lastSeen || null });
        });
        return next;
      });
    };
    const handlePresenceOffline = ({ userId, lastSeen }) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(userId, { online: false, lastSeen: lastSeen || prev.get(userId)?.lastSeen || null });
        return next;
      });
    };
    s.on('profileUpdated', handleProfileUpdatedFromSocket);
    s.on('call:incoming', handleIncomingCall);
    s.on('presence:online', handlePresenceOnline);
    s.on('presence:offline', handlePresenceOffline);
    s.on('presence:sync', handlePresenceSync);
    return () => {
      s.off('call:incoming', handleIncomingCall);
      s.off('profileUpdated', handleProfileUpdatedFromSocket);
      s.off('presence:online', handlePresenceOnline);
      s.off('presence:offline', handlePresenceOffline);
      s.off('presence:sync', handlePresenceSync);
    };
  }, [token]);

  // Foreground/background presence. The socket stays connected either way (call
  // signaling rides it), but we tell the server which state we're in: while
  // foregrounded the server delivers messages live over the socket and skips
  // the push; once backgrounded it sends a "New message" push instead. Without
  // this the server always sees a connected socket as "online" and no message
  // push ever fires. Calls are unaffected - call:invite still uses raw online
  // state and its own wake-up push.
  useEffect(() => {
    if (!socket) return undefined;
    let bgTimer = null;
    const clearBgTimer = () => {
      if (bgTimer) {
        clearTimeout(bgTimer);
        bgTimer = null;
      }
    };
    const emitForeground = () => {
      clearBgTimer();
      socket.emit('presence:foreground');
    };
    const scheduleBackground = () => {
      clearBgTimer();
      // grace period: a quick app-switch (camera, share sheet, permission
      // dialog) shouldn't bounce delivery over to push and straight back.
      bgTimer = setTimeout(() => {
        bgTimer = null;
        socket.emit('presence:background');
      }, 8000);
    };
    // Re-assert current state on (re)connect - socket.io may reconnect after a
    // network blip while we're backgrounded, and a fresh server socket defaults
    // to "foreground".
    const syncNow = () => {
      socket.emit(
        AppState.currentState === 'active' ? 'presence:foreground' : 'presence:background'
      );
    };

    syncNow();
    socket.on('connect', syncNow);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') emitForeground();
      else if (next === 'background') scheduleBackground();
      // 'inactive' (iOS transient / app switcher) is intentionally ignored
    });

    return () => {
      clearBgTimer();
      socket.off('connect', syncNow);
      sub.remove();
    };
  }, [socket]);

  const handleLoggedIn = async (newToken, user) => {
    await AsyncStorage.setItem('token', newToken);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    setToken(newToken);
    setCurrentUser(user);
    setScreen('chatList');
  };

  // The profile-picture picker runs HERE, at the App.js level, and never from
  // inside a Modal. expo-image-picker's launchImageLibraryAsync throws
  // "ActivityResultLauncher not registered" on Android (New Architecture) when
  // it is called from a component mounted inside a <Modal> tree. ProfileScreen
  // calls this through the onChangeProfilePicture prop and only manages its
  // own spinner. Errors propagate so ProfileScreen can surface them.
  const handleChangeProfilePicture = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'We need access to your photos.');
      return;
    }
    // Gallery only. `allowsEditing: true` is expo-image-picker's built-in crop
    // UI; `quality: 1` keeps the full-size cropped original.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      base64: true,
    });
    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.base64) {
      Alert.alert('Error', 'Could not read the selected image.');
      return;
    }
    // Backend stores the data URI verbatim in a TEXT column; the REST JSON body
    // limit is 8 MB. Reject oversized images up front.
    if (asset.base64.length > 7 * 1024 * 1024) {
      Alert.alert('Photo too large', 'That image is too big. Please pick a smaller one.');
      return;
    }

    const dataUri = `data:image/jpeg;base64,${asset.base64}`;
    await updateProfilePicture(token, dataUri);
    setCurrentUser((prev) => {
      const updated = { ...prev, profilePicture: dataUri };
      AsyncStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
    Alert.alert('Updated', 'Profile picture updated.');
  }, [token]);

  const openSettingsSection = (key) => {
    const map = {
      account: 'settingsAccount',
      privacy: 'settingsPrivacy',
      chats: 'settingsChats',
      appearance: 'settingsAppearance',
      notifications: 'settingsNotifications',
      invite: 'settingsInvite',
    };
    setScreen(map[key] || 'settings');
  };

  const handleUserUpdated = async (updatedFields) => {
    const updatedUser = { ...currentUser, ...updatedFields };
    setCurrentUser(updatedUser);
    await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
  };

  const handleLogout = async () => {
    // Tell the server to drop this device's push token BEFORE we lose the
    // auth token. Best-effort - never let it block logout.
    try {
      await unregisterDeviceForPush(token);
    } catch (e) {
      /* ignore */
    }
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    disconnectSocket();
    setToken(null);
    setCurrentUser(null);
    setBanner(null);
    setScreen('login');
  };

  const openChat = (chatInfo) => {
    setActiveChat(chatInfo);
    setScreen('chat');
  };

  const startCall = (targetUserId, targetName, callType) => {
    setOutgoingCall({ mode: 'outgoing', targetUserId, targetName, callType });
  };

  // --- Push notifications -------------------------------------------------

  // Ask for permission once (with a plain-language reason first), then
  // register this device. Runs whenever we have a session - on fresh login
  // and on a restored session at launch. Denial is fine: the app just won't
  // get notifications.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;

    (async () => {
      const status = await getPermissionStatus();
      if (cancelled) return;

      if (status === 'granted') {
        registerDeviceForPush(token);
        return;
      }
      if (status !== 'undetermined') return; // 'denied' - respect it
      if (await hasAskedPermission()) return; // asked before, don't nag

      Alert.alert(
        'Turn on notifications?',
        'Wave can let you know about new messages and calls even when the app is closed. You can change this later in your phone settings.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => markAskedPermission() },
          {
            text: 'Turn on',
            onPress: async () => {
              const granted = await requestPermission();
              if (granted && !cancelled) registerDeviceForPush(token);
            },
          },
        ]
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Where a tapped / in-app-tapped notification takes the user.
  const routeFromNotification = useCallback(
    async (data) => {
      if (!data || !token) return;

      if (data.type === 'call') {
        setIncomingCall({
          mode: 'incoming',
          callId: data.callId,
          fromUserId: Number(data.fromUserId),
          fromName: data.fromName,
          callType: data.callType,
        });
        return;
      }
      if (data.type === 'missedCall') {
        setScreen('calls');
        return;
      }
      if (data.type === 'message' && data.conversationId) {
        try {
          const list = await getConversations(token);
          const conv = (Array.isArray(list) ? list : []).find(
            (c) => String(c.id) === String(data.conversationId)
          );
          if (conv) {
            setActiveChat({
              conversationId: conv.id,
              otherUser: conv.with,
              isGroup: !!conv.is_group,
              groupName: conv.name,
            });
            setScreen('chat');
            return;
          }
        } catch (e) {
          /* fall through to the list */
        }
        setScreen('chatList');
      }
    },
    [token]
  );

  // Foreground receipt -> our own banner. Tap (foreground or from the tray,
  // including a cold start) -> route.
  useEffect(() => {
    const recvSub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content;
      if (!content) return;
      setBanner({ title: content.title, body: content.body, data: content.data || {} });
    });
    const respSub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeFromNotification(response?.notification?.request?.content?.data || {});
    });
    // app launched by tapping a notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) routeFromNotification(response.notification?.request?.content?.data || {});
    });

    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [routeFromNotification]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const showTabBar = TAB_SCREENS.includes(screen);

  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {screen === 'login' && (
            <LoginScreen
              onLoggedIn={handleLoggedIn}
              goToSignup={() => setScreen('signup')}
              goToForgotPassword={() => setScreen('forgotPassword')}
            />
          )}
          {screen === 'signup' && (
            <SignupScreen goToLogin={() => setScreen('login')} />
          )}
          {screen === 'forgotPassword' && (
            <ForgotPasswordScreen onBack={() => setScreen('login')} />
          )}
          {screen === 'chatList' && (
            <ChatListScreen
              token={token}
              currentUser={currentUser}
              presenceMap={presenceMap}
              onOpenChat={openChat}
              onLogout={handleLogout}
              onOpenProfile={() => setScreen('settings')}
              onOpenStarred={() => setScreen('starredMessages')}
              onOpenArchived={() => setScreen('archivedChats')}
            />
          )}
          {screen === 'starredMessages' && (
            <StarredMessagesScreen
              token={token}
              onBack={() => setScreen('chatList')}
              onOpenChat={openChat}
            />
          )}
          {screen === 'archivedChats' && (
            <ArchivedChatsScreen
              token={token}
              presenceMap={presenceMap}
              onBack={() => setScreen('chatList')}
              onOpenChat={openChat}
            />
          )}
          {screen === 'calls' && (
            <CallsScreen token={token} currentUser={currentUser} onStartCall={startCall} onOpenChat={openChat} />
          )}
          {screen === 'updates' && (
            <UpdatesScreen currentUser={currentUser} />
          )}
          {screen === 'chat' && activeChat && (
            <ChatScreen
              token={token}
              currentUser={currentUser}
              conversationId={activeChat.conversationId}
              otherUser={activeChat.otherUser}
              isGroup={activeChat.isGroup}
              groupName={activeChat.groupName}
              presenceMap={presenceMap}
              jumpToMessageId={activeChat.scrollToMessageId}
              onStartCall={startCall}
              onBack={() => setScreen('chatList')}
            />
          )}
          {screen === 'profile' && (
            <ProfileScreen
              token={token}
              currentUser={currentUser}
              onBack={() => setScreen('settings')}
              onLogout={handleLogout}
              onChangeProfilePicture={handleChangeProfilePicture}
            />
          )}
          {screen === 'settings' && (
            <SettingsScreen
              currentUser={currentUser}
              onBack={() => setScreen('chatList')}
              onOpenProfile={() => setScreen('profile')}
              onOpenSection={openSettingsSection}
              onLogout={handleLogout}
            />
          )}
          {screen === 'settingsAccount' && (
            <AccountSettingsScreen
              token={token}
              currentUser={currentUser}
              onBack={() => setScreen('settings')}
              onUserUpdated={handleUserUpdated}
              onLogout={handleLogout}
            />
          )}
          {screen === 'settingsPrivacy' && (
            <PrivacySettingsScreen
              token={token}
              onBack={() => setScreen('settings')}
            />
          )}
          {screen === 'settingsChats' && (
            <ChatsSettingsScreen onBack={() => setScreen('settings')} />
          )}
          {screen === 'settingsAppearance' && (
            <AppearanceSettingsScreen onBack={() => setScreen('settings')} />
          )}
          {screen === 'settingsNotifications' && (
            <NotificationsSettingsScreen onBack={() => setScreen('settings')} />
          )}
          {screen === 'settingsInvite' && (
            <InviteFriendScreen onBack={() => setScreen('settings')} />
          )}
        </View>

        {showTabBar && (
          <BottomTabBar activeTab={screen} onTabPress={(tab) => setScreen(tab)} />
        )}
      </View>

      {socket && incomingCall && (
        <CallScreen socket={socket} callInfo={incomingCall} onEndCall={() => setIncomingCall(null)} />
      )}
      {socket && outgoingCall && (
        <CallScreen socket={socket} callInfo={outgoingCall} onEndCall={() => setOutgoingCall(null)} />
      )}

      <NotificationBanner
        banner={banner}
        onDismiss={() => setBanner(null)}
        onPress={(data) => routeFromNotification(data)}
      />
    </KeyboardProvider>
  );
}



