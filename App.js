import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ChatListScreen from './src/screens/ChatListScreen';
import ChatScreen from './src/screens/ChatScreen';
import { disconnectSocket } from './src/utils/socket';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('login'); // login | signup | chatList | chat
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeConversation, setActiveConversation] = useState(null); // { id, with }

  // On app start, check if we already have a saved login.
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

  const openChat = (conversationId, otherUser) => {
    setActiveConversation({ id: conversationId, with: otherUser });
    setScreen('chat');
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
        />
      )}
      {screen === 'chat' && (
        <ChatScreen
          token={token}
          currentUser={currentUser}
          conversationId={activeConversation.id}
          otherUser={activeConversation.with}
          onBack={() => setScreen('chatList')}
        />
      )}
    </>
  );
}
