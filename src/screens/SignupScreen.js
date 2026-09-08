import React, { useState } from 'react';
import { Alert } from 'react-native';
import { signup } from '../utils/api';
import { AuthShell, AuthTabs, AuthField, isValidEmail } from '../components/AuthUI';
import LoginBarButton from '../components/LoginBarButton';

export default function SignupScreen({ goToLogin }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[^\d]/g, '');
    const cleanEmail = email.trim();

    if (!cleanName || !cleanPhone || !cleanEmail || !password) {
      Alert.alert('Missing info', 'Please fill in every field.');
      return;
    }
    // Format-check the email before anything touches the network.
    if (!isValidEmail(cleanEmail)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    if (cleanPhone.length < 10) {
      Alert.alert('Check your number', 'Enter your 10-digit phone number.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Use at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      await signup(cleanName, cleanEmail, password, `+91${cleanPhone}`);
      Alert.alert(
        'Check your email',
        'We sent you a verification link. Verify your account, then log in.',
        [{ text: 'OK', onPress: goToLogin }]
      );
    } catch (err) {
      Alert.alert('Signup failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthTabs active="signup" onLogin={goToLogin} />

      <AuthField
        label="Full name"
        placeholder="Jane Doe"
        value={name}
        onChangeText={setName}
        returnKeyType="next"
      />

      <AuthField
        label="Phone number"
        prefix="+91"
        placeholder="98765 43210"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        returnKeyType="next"
      />

      <AuthField
        label="Email"
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          if (emailError) setEmailError(null);
        }}
        error={emailError}
        returnKeyType="next"
      />

      <AuthField
        label="Password"
        placeholder="At least 6 characters"
        secureToggle
        autoCapitalize="none"
        value={password}
        onChangeText={setPassword}
        returnKeyType="go"
        onSubmitEditing={handleSignup}
      />

      <LoginBarButton label="Create Account" onPress={handleSignup} loading={loading} />
    </AuthShell>
  );
}
