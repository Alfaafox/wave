// App.js
// Top-level component: shows the login screen if we don't have a saved
// login token yet, otherwise shows the chat screen directly (so people
// don't have to log in every single time they open the app).

import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

import LoginScreen from './src/screens/LoginScreen';
import ChatScreen from './src/screens/ChatScreen';

const STORAGE_KEY = 'chat_app_session';

export default function App() {
  const [session, setSession] = useState(null); // { token, username }
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSession(JSON.parse(raw));
      })
      .finally(() => setCheckingSession(false));
  }, []);

  function handleAuthenticated(token, username) {
    const newSession = { token, username };
    setSession(newSession);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
  }

  function handleLogout() {
    setSession(null);
    AsyncStorage.removeItem(STORAGE_KEY);
  }

  if (checkingSession) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <>
      {session ? (
        <ChatScreen
          token={session.token}
          username={session.username}
          onLogout={handleLogout}
        />
      ) : (
        <LoginScreen onAuthenticated={handleAuthenticated} />
      )}
      <StatusBar style="auto" />
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
