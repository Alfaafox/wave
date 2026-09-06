import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import SettingsSubScreenLayout from './SettingsSubScreenLayout';
import { colors, spacing, radii, shadow } from '../theme';

// Generic "edit one field, save, go back" screen. Used for Name and Email
// today; any future single-field edit (e.g. a status message) can reuse
// this instead of a new near-duplicate screen.
//
// onSave should be an async function that performs the actual save (API
// call + propagating the update to shared app state via onUserUpdated).
// If it resolves without throwing, this screen navigates back on its own -
// callers don't need to separately call onBack after a successful save.
export default function EditFieldScreen({ title, label, initialValue, placeholder, keyboardType, onSave, onBack }) {
  const [value, setValue] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) {
      Alert.alert('Cannot be empty', `${label} cannot be empty.`);
      return;
    }
    setSaving(true);
    try {
      await onSave(value.trim());
      onBack();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSubScreenLayout title={title} onBack={onBack}>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
          autoFocus
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.saveButtonText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, ...shadow.md },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md
  },
  saveButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingVertical: spacing.md, alignItems: 'center' },
  saveButtonText: { color: colors.textOnAccent, fontWeight: '600', fontSize: 15 }
});
