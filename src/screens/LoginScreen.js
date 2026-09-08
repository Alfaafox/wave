import React, { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { login, SERVER_URL } from '../utils/api';
import { AuthShell, AuthTabs, AuthField, AuthLink } from '../components/AuthUI';
import LoginBarButton from '../components/LoginBarButton';
import { spacing } from '../theme';

export default function LoginScreen({ onLoggedIn, goToSignup, goToForgotPassword }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const id = identifier.trim();
    if (!id || !password) {
      Alert.alert('Missing info', 'Enter your phone number or email, and your password.');
      return;
    }
    setLoading(true);
    try {
      const data = await login(id, password);
      setLoading(false);
      if (data.reactivated) {
        Alert.alert(
          'Welcome back',
          'Your account has been reactivated. Everything is right where you left it.',
          [{ text: 'Continue', onPress: () => onLoggedIn(data.token, data.user) }]
        );
      } else {
        onLoggedIn(data.token, data.user);
      }
    } catch (err) {
      setLoading(false);
      Alert.alert('Login failed', `${err.message}\n\nTrying to reach: ${SERVER_URL}`);
    }
  };

  return (
    <AuthShell>
      <AuthTabs active="login" onSignup={goToSignup} />

      <AuthField
        label="Phone number or email"
        placeholder="you@example.com or 98765 43210"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={identifier}
        onChangeText={setIdentifier}
        returnKeyType="next"
      />

      <AuthField
        label="Password"
        placeholder="Your password"
        secureToggle
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={handleLogin}
      />

      <AuthLink align="right" onPress={goToForgotPassword} style={styles.forgot}>
        Forgot Password?
      </AuthLink>

      <LoginBarButton onPress={handleLogin} loading={loading} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  forgot: { marginTop: -spacing.sm, marginBottom: spacing.md },
});
