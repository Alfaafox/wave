import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import CallScreen from './src/screens/CallScreen';
import { disconnectSocket, connectSocket } from './src/utils/socket';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('login'); // login | signup | chatList | chat | profile
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeChat, setActiveChat] = useState(null); // { conversationId, otherUser, isGroup, groupName }
  const [socket, setSocket] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [outgoingCall, setOutgoingCall] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const savedToken = await AsyncStorage.getItem('token');
        const savedUser = await AsyncStorage.getItem('user');
        if (savedToken && savedUser) {
          setToken(savedToken);
          setCurrentUser(JSON.parse(savedUser));
          setScreen('chatList');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }
    const s = connectSocket(token);
    setSocket(s);
    const handleIncomingCall = ({ callId, fromUserId, fromName, callType }) => {
      setIncomingCall({ mode: 'incoming', callId, fromUserId, fromName, callType });
    };
    s.on('call:incoming', handleIncomingCall);
    return () => {
      s.off('call:incoming', handleIncomingCall);
    };
  }, [token]);

  const handleLoggedIn = async (newToken, user) => {
    await AsyncStorage.setItem('token', newToken);
    await AsyncStorage.setItem('user', JSON.stringify(user));
    setToken(newToken);
    setCurrentUser(user);
    setScreen('chatList');
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('user');
    disconnectSocket();
    setToken(null);
    setCurrentUser(null);
    setScreen('login');
  };

  const openChat = (chatInfo) => {
    setActiveChat(chatInfo);
    setScreen('chat');
  };

  const startCall = (targetUserId, targetName, callType) => {
    setOutgoingCall({ mode: 'outgoing', targetUserId, targetName, callType });
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#075E54" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {screen === 'login' && (
        <LoginScreen onLoggedIn={handleLoggedIn} goToSignup={() => setScreen('signup')} />
      )}
      {screen === 'signup' && (
        <SignupScreen goToLogin={() => setScreen('login')} />
      )}
      {screen === 'chatList' && (
        <ChatListScreen
          token={token}
          currentUser={currentUser}
          onOpenChat={openChat}
          onLogout={handleLogout}
          onOpenProfile={() => setScreen('profile')}
        />
      )}
      {screen === 'chat' && activeChat && (
        <ChatScreen
          token={token}
          currentUser={currentUser}
          conversationId={activeChat.conversationId}
          otherUser={activeChat.otherUser}
          isGroup={activeChat.isGroup}
          groupName={activeChat.groupName}
          onStartCall={startCall}
          onBack={() => setScreen('chatList')}
        />
      )}
      {screen === 'profile' && (
        <ProfileScreen
          token={token}
          currentUser={currentUser}
          onBack={() => setScreen('chatList')}
          onLogout={handleLogout}
        />
      )}
      {socket && incomingCall && (
        <CallScreen socket={socket} callInfo={incomingCall} onEndCall={() => setIncomingCall(null)} />
      )}
      {socket && outgoingCall && (
        <CallScreen socket={socket} callInfo={outgoingCall} onEndCall={() => setOutgoingCall(null)} />
      )}
    </>
  );
}
