import React, { useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { forgotPassword } from '../utils/api';
import { AuthShell, AuthField, AuthLink } from '../components/AuthUI';
import LoginBarButton from '../components/LoginBarButton';
import { colors, spacing, radii, typography } from '../theme';

export default function ForgotPasswordScreen({ onBack }) {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  // null while on the form; { channel, message, identifier } once submitted.
  const [sent, setSent] = useState(null);

  const isEmail = identifier.includes('@');

  const handleSend = async () => {
    const id = identifier.trim();
    if (!id) {
      Alert.alert('Missing info', 'Enter your email or phone number.');
      return;
    }
    setLoading(true);
    try {
      const res = await forgotPassword(id);
      setSent({ channel: res.channel, message: res.message, identifier: id });
    } catch (err) {
      Alert.alert('Could not send reset', err.message);
    } finally {
      setLoading(false);
    }
  };

  const backLink = (
    <Pressable onPress={onBack} hitSlop={10} style={styles.back} accessibilityRole="button">
      <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      <Text style={styles.backText}>Back to login</Text>
    </Pressable>
  );

  if (sent) {
    return (
      <AuthShell topSlot={backLink}>
        <View style={styles.card}>
          <Ionicons
            name={sent.channel === 'email' ? 'mail-outline' : 'chatbubble-ellipses-outline'}
            size={30}
            color={colors.accent}
            style={{ marginBottom: spacing.sm }}
          />
          <Text style={styles.cardTitle}>
            {sent.channel === 'email' ? 'Check your email' : 'Reset code sent'}
          </Text>
          <Text style={styles.cardBody}>{sent.message}</Text>

          {sent.channel === 'email' ? (
            <Text style={styles.cardHint}>
              The link opens a page where you can set a new password. It expires in 1 hour. Don&apos;t
              forget to check your spam folder.
            </Text>
          ) : (
            <Text style={styles.cardHint}>
              Resetting by text message isn&apos;t switched on yet. If you need to get back in now,
              use the email address linked to your account instead.
            </Text>
          )}
        </View>

        <View style={styles.footer}>
          <AuthLink onPress={onBack}>Back to login</AuthLink>
          <AuthLink onPress={() => setSent(null)} style={{ marginTop: spacing.md }}>
            Use a different email or phone
          </AuthLink>
        </View>
      </AuthShell>
    );
  }

  return (
    <AuthShell topSlot={backLink}>
      <Text style={styles.title}>Reset your password</Text>
      <Text style={styles.subtitle}>
        Enter the email or phone number linked to your account and we&apos;ll send you a way to set a
        new password.
      </Text>

      <AuthField
        label="Phone number or email"
        placeholder="you@example.com or 98765 43210"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={identifier}
        onChangeText={setIdentifier}
        returnKeyType="go"
        onSubmitEditing={handleSend}
      />

      {identifier.length > 0 && !isEmail ? (
        <Text style={styles.smsNote}>
          Heads up: password reset by text message is still rolling out. Using your account email is
          the reliable option today.
        </Text>
      ) : null}

      <LoginBarButton
        label={isEmail || identifier.length === 0 ? 'Send Reset Link' : 'Send Reset Code'}
        onPress={handleSend}
        loading={loading}
        style={{ marginTop: spacing.sm }}
      />

      <View style={styles.footer}>
        <AuthLink onPress={onBack}>Remembered it? Log in</AuthLink>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  backText: { marginLeft: spacing.xs, fontSize: 15, fontWeight: '600', color: colors.textPrimary },

  title: { ...typography.headerTitle, fontSize: 22, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  smsNote: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.warning,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.xs,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  cardBody: { fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  cardHint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },

  footer: { alignItems: 'center', marginTop: spacing.xl },
});
