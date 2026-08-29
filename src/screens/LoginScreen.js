import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { login, SERVER_URL } from '../utils/api';

export default function LoginScreen({ onLoggedIn, goToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing info', 'Please enter both email and password');
      return;
    }
    setLoading(true);
    try {
      const data = await login(email.trim(), password);
      setLoading(false);
      onLoggedIn(data.token, data.user);
    } catch (err) {
      setLoading(false);
      Alert.alert('Login failed', `${err.message}\n\nTrying to reach: ${SERVER_URL}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Wave</Text>
      <Text style={styles.subtitle}>Log in to continue</Text>
      <Text style={styles.debug}>Server: {SERVER_URL}</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Log In</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={goToSignup} style={{ marginTop: 20 }}>
        <Text style={styles.link}>Don't have an account? Sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 36, fontWeight: 'bold', textAlign: 'center', color: '#075E54' },
  subtitle: { fontSize: 16, textAlign: 'center', color: '#666', marginBottom: 8 },
  debug: { fontSize: 11, textAlign: 'center', color: '#aaa', marginBottom: 24 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 14,
    marginBottom: 14, fontSize: 16
  },
  button: {
    backgroundColor: '#075E54', borderRadius: 10, padding: 16,
    alignItems: 'center', marginTop: 8
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#075E54', textAlign: 'center', fontSize: 14 }
});
