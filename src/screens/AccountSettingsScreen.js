import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import EditFieldScreen from '../components/EditFieldScreen';
import { updateProfile, changePassword, deactivateAccount, deleteAccount } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';

// Dedicated change-password screen. Kept local to this file since it's
// only ever reached from the Account list below - if it ever needs reuse
// elsewhere, it can be promoted to its own file at that point.
function ChangePasswordScreen({ token, onBack }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Missing info', 'Fill in all three password fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Too short', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'The new password and confirmation must match.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(token, currentPassword, newPassword);
      Alert.alert('Password changed', 'Your password has been updated.', [{ text: 'OK', onPress: onBack }]);
    } catch (err) {
      Alert.alert('Could not change password', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSubScreenLayout title="Change Password" onBack={onBack}>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Current password</Text>
        <TextInput
          style={styles.input}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Current password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
        />
        <Text style={styles.fieldLabel}>New password</Text>
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
        />
        <Text style={styles.fieldLabel}>Confirm new password</Text>
        <TextInput
          style={styles.input}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Re-enter new password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleChangePassword} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.saveButtonText}>Change password</Text>}
        </TouchableOpacity>
      </View>
    </SettingsSubScreenLayout>
  );
}

function Bullets({ lines }) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      {lines.map((line) => (
        <View key={line} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>{'•'}</Text>
          <Text style={styles.bulletText}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

// Reversible. Confirm alert -> deactivate -> the account is now blocked by
// the server, so we log out on this device (onDone === App's handleLogout).
function DeactivateAccountScreen({ token, onDone, onBack }) {
  const [working, setWorking] = useState(false);

  const runDeactivate = async () => {
    setWorking(true);
    try {
      await deactivateAccount(token);
      Alert.alert(
        'Account deactivated',
        'You have been logged out. Log in again anytime to reactivate your account - nothing has been deleted.',
        [{ text: 'OK', onPress: onDone }]
      );
    } catch (err) {
      setWorking(false);
      Alert.alert('Could not deactivate', err.message);
    }
  };

  const confirm = () => {
    Alert.alert(
      'Deactivate account?',
      'You can reactivate by logging in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: runDeactivate },
      ]
    );
  };

  return (
    <SettingsSubScreenLayout title="Deactivate Account" onBack={onBack}>
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>While deactivated</Text>
        <Bullets lines={[
          'You are logged out on this device',
          "You won't show up in other people's contacts",
          'People cannot call you',
          'Your chats, messages and call history are kept',
          'Logging in again restores everything',
        ]} />
      </View>

      <TouchableOpacity style={styles.dangerButton} onPress={confirm} disabled={working} activeOpacity={0.85}>
        {working ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.dangerButtonText}>Deactivate Account</Text>}
      </TouchableOpacity>
    </SettingsSubScreenLayout>
  );
}

// Irreversible. Typing DELETE is the confirmation (no extra alert). On
// success we log out (onDone === App's handleLogout).
function DeleteAccountScreen({ token, onDone, onBack }) {
  const [confirmText, setConfirmText] = useState('');
  const [working, setWorking] = useState(false);
  const canDelete = confirmText === 'DELETE';

  const runDelete = async () => {
    if (!canDelete || working) return;
    setWorking(true);
    try {
      await deleteAccount(token);
      Alert.alert(
        'Account deleted',
        'Your account and profile photo have been removed. Your past messages now show as "Deleted User".',
        [{ text: 'OK', onPress: onDone }]
      );
    } catch (err) {
      setWorking(false);
      Alert.alert('Could not delete account', err.message);
    }
  };

  return (
    <SettingsSubScreenLayout title="Delete Account" onBack={onBack}>
      <View style={styles.dangerCard}>
        <Text style={styles.dangerTitle}>This permanently</Text>
        <Bullets lines={[
          'Deletes your account and profile photo',
          'Removes you from every group chat',
          'Replaces your name with "Deleted User" on past messages',
          'Cannot be undone',
        ]} />
        <Text style={styles.dangerText}>
          Your past messages and calls stay visible to other people, shown as "Deleted User".
        </Text>
      </View>

      <Text style={styles.confirmLabel}>Type DELETE to confirm</Text>
      <TextInput
        style={styles.input}
        value={confirmText}
        onChangeText={setConfirmText}
        placeholder="DELETE"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.dangerButton, !canDelete && styles.dangerButtonDisabled]}
        onPress={runDelete}
        disabled={!canDelete || working}
        activeOpacity={0.85}
      >
        {working ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.dangerButtonText}>Delete Account</Text>}
      </TouchableOpacity>
    </SettingsSubScreenLayout>
  );
}

export default function AccountSettingsScreen({ token, currentUser, onBack, onUserUpdated, onLogout }) {
  // Local sub-navigation, contained entirely within this section - App.js
  // doesn't know or care about any of these sub-screens.
  const [subScreen, setSubScreen] = useState(null); // null | 'name' | 'email' | 'password' | 'deactivate' | 'delete'

  const saveName = async (newName) => {
    const result = await updateProfile(token, newName, currentUser?.email || '');
    onUserUpdated?.({ name: result.user.name, email: result.user.email });
  };

  const saveEmail = async (newEmail) => {
    const result = await updateProfile(token, currentUser?.name || '', newEmail);
    onUserUpdated?.({ name: result.user.name, email: result.user.email });
  };

  if (subScreen === 'name') {
    return (
      <EditFieldScreen
        title="Edit Name"
        label="Name"
        initialValue={currentUser?.name || ''}
        placeholder="Your name"
        onSave={saveName}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'email') {
    return (
      <EditFieldScreen
        title="Edit Email"
        label="Email"
        initialValue={currentUser?.email || ''}
        placeholder="Your email"
        keyboardType="email-address"
        onSave={saveEmail}
        onBack={() => setSubScreen(null)}
      />
    );
  }

  if (subScreen === 'password') {
    return <ChangePasswordScreen token={token} onBack={() => setSubScreen(null)} />;
  }

  if (subScreen === 'deactivate') {
    return <DeactivateAccountScreen token={token} onDone={onLogout} onBack={() => setSubScreen(null)} />;
  }

  if (subScreen === 'delete') {
    return <DeleteAccountScreen token={token} onDone={onLogout} onBack={() => setSubScreen(null)} />;
  }

  // Default: the Account list
  return (
    <SettingsSubScreenLayout title="Account" onBack={onBack}>
      <View style={styles.rowsCard}>
        <TouchableOpacity style={styles.row} onPress={() => setSubScreen('name')} activeOpacity={0.6}>
          <Text style={styles.rowLabel}>Name</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue} numberOfLines={1}>{currentUser?.name || '-'}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => setSubScreen('email')} activeOpacity={0.6}>
          <Text style={styles.rowLabel}>Email</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue} numberOfLines={1}>{currentUser?.email || '-'}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.row, styles.rowLast]} onPress={() => setSubScreen('password')} activeOpacity={0.6}>
          <Text style={styles.rowLabel}>Password</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.deleteRow} onPress={() => setSubScreen('deactivate')} activeOpacity={0.6}>
        <Text style={styles.deleteRowText}>Deactivate Account</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.deleteRowTight} onPress={() => setSubScreen('delete')} activeOpacity={0.6}>
        <Text style={styles.deleteRowText}>Delete Account</Text>
      </TouchableOpacity>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  rowsCard: { backgroundColor: colors.surface, borderRadius: radii.md, ...shadow.md },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.divider
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: 15, color: colors.textPrimary },
  rowRight: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end', marginLeft: spacing.md },
  rowValue: { fontSize: 14, color: colors.textMuted, marginRight: spacing.sm, flexShrink: 1 },

  deleteRow: { marginTop: spacing.xl, alignItems: 'center', padding: spacing.md },
  deleteRowTight: { marginTop: spacing.xs, alignItems: 'center', padding: spacing.md },
  deleteRowText: { color: colors.danger, fontSize: 15, fontWeight: '600' },

  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, ...shadow.md },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: spacing.md, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.xs
  },
  saveButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  saveButtonText: { color: colors.textOnAccent, fontWeight: '600', fontSize: 15 },

  dangerCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.danger, ...shadow.md },
  dangerTitle: { fontSize: 15, fontWeight: '600', color: colors.danger, marginBottom: spacing.xs },
  dangerText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.md },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.xs },
  bulletDot: { fontSize: 13, color: colors.textSecondary, marginRight: spacing.sm, lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  confirmLabel: { fontSize: 12, color: colors.textMuted, marginTop: spacing.lg, marginBottom: 4 },
  dangerButton: {
    backgroundColor: colors.danger, borderRadius: radii.pill,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg
  },
  dangerButtonDisabled: { opacity: 0.4 },
  dangerButtonText: { color: colors.textOnAccent, fontWeight: '700', fontSize: 15 }
});
