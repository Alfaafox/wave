import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import EditFieldScreen from '../components/EditFieldScreen';
import { updateProfile, changePassword } from '../utils/api';
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

function DeleteAccountScreen({ onBack }) {
  return (
    <SettingsSubScreenLayout title="Delete Account" onBack={onBack}>
      <View style={styles.dangerCard}>
        <Ionicons name="warning-outline" size={22} color={colors.danger} style={{ marginBottom: spacing.sm }} />
        <Text style={styles.dangerTitle}>This is being built next</Text>
        <Text style={styles.dangerText}>
          Account deletion needs a careful pass over every table your data touches, so it isn't
          rushed. It will be available here shortly.
        </Text>
      </View>
    </SettingsSubScreenLayout>
  );
}

export default function AccountSettingsScreen({ token, currentUser, onBack, onUserUpdated }) {
  // Local sub-navigation, contained entirely within this section - App.js
  // doesn't know or care about any of these sub-screens.
  const [subScreen, setSubScreen] = useState(null); // null | 'name' | 'email' | 'password' | 'delete'

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

  if (subScreen === 'delete') {
    return <DeleteAccountScreen onBack={() => setSubScreen(null)} />;
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

      <TouchableOpacity style={styles.deleteRow} onPress={() => setSubScreen('delete')} activeOpacity={0.6}>
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
  dangerText: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 }
});
