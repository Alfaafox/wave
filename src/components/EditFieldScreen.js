import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from './SettingsSubScreenLayout';
import { colors, spacing, radii, shadow } from '../theme';

// Generic "edit one field, save, go back" screen. Used for Name and Username.
//
// onSave should be an async function that performs the actual save (API call +
// propagating the update via onUserUpdated). If it resolves without throwing,
// this screen navigates back on its own.
//
// Optional props for a validated / live-checked field (Username):
//   normalize(text)          -> transform each keystroke (lowercase, strip)
//   validate(value)          -> error string, or null/'' if the format is fine
//   checkAvailability(value) -> Promise<{ available, reason?, self? }>, run
//                               600ms after the last keystroke; drives the
//                               inline Ionicons status line
//   allowEmpty               -> saving an empty value is allowed (clears it)
//   helperText / prefix      -> static helper under the field / leading '@'
export default function EditFieldScreen({
  title, label, initialValue, placeholder, keyboardType, onSave, onBack,
  normalize, validate, checkAvailability, allowEmpty, helperText, prefix,
  autoCapitalize, autoCorrect, maxLength,
}) {
  const [value, setValue] = useState(initialValue || '');
  const [saving, setSaving] = useState(false);
  // 'idle' | 'checking' | 'ok' | 'unavailable' | 'invalid'
  const [status, setStatus] = useState('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const initialTrimmed = (initialValue || '').trim();
  const trimmed = value.trim();
  const unchanged = trimmed === initialTrimmed;

  const handleChange = (text) => setValue(normalize ? normalize(text) : text);

  useEffect(() => {
    if (!validate && !checkAvailability) return undefined;
    clearTimeout(debounceRef.current);
    const v = trimmed;

    if (unchanged || (allowEmpty && v === '')) {
      setStatus('idle');
      setStatusMsg('');
      return undefined;
    }

    if (validate) {
      const err = validate(v);
      if (err) {
        setStatus('invalid');
        setStatusMsg(err);
        return undefined;
      }
    }
    if (!checkAvailability) {
      setStatus('ok');
      setStatusMsg('');
      return undefined;
    }

    setStatus('checking');
    setStatusMsg('');
    const myReq = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await checkAvailability(v);
        if (myReq !== reqIdRef.current) return;
        if (r && r.available) {
          setStatus('ok');
          setStatusMsg(r.self ? 'This is your current username' : 'Available');
        } else {
          setStatus('unavailable');
          setStatusMsg(r && r.reason === 'invalid' ? 'Not a valid username' : 'Already taken');
        }
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        setStatus('idle');
        setStatusMsg('');
      }
    }, 600);

    return () => clearTimeout(debounceRef.current);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (unchanged) { onBack(); return; }
    if (!trimmed && !allowEmpty) {
      Alert.alert('Cannot be empty', `${label} cannot be empty.`);
      return;
    }
    if (trimmed && validate) {
      const err = validate(trimmed);
      if (err) { Alert.alert('Invalid', err); return; }
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      onBack();
    } catch (err) {
      Alert.alert('Could not save', err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled = saving
    || status === 'checking'
    || status === 'invalid'
    || (!!checkAvailability && status === 'unavailable');

  const renderStatus = () => {
    if (status === 'checking') {
      return (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={[styles.statusText, { color: colors.textMuted }]}>Checking availability...</Text>
        </View>
      );
    }
    if (status === 'ok') {
      return (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.online} />
          <Text style={[styles.statusText, { color: colors.online }]}>{statusMsg || 'Available'}</Text>
        </View>
      );
    }
    if (status === 'unavailable' || status === 'invalid') {
      return (
        <View style={styles.statusRow}>
          <Ionicons
            name={status === 'invalid' ? 'alert-circle' : 'close-circle'}
            size={16}
            color={colors.danger}
          />
          <Text style={[styles.statusText, { color: colors.danger }]}>{statusMsg}</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SettingsSubScreenLayout title={title} onBack={onBack}>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.inputRow}>
          {!!prefix && <Text style={styles.prefix}>{prefix}</Text>}
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={handleChange}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize || (keyboardType === 'email-address' ? 'none' : 'sentences')}
            autoCorrect={autoCorrect === undefined ? true : autoCorrect}
            maxLength={maxLength}
            autoFocus
          />
        </View>

        {!!helperText && <Text style={styles.helper}>{helperText}</Text>}
        {renderStatus()}

        <TouchableOpacity
          style={[styles.saveButton, saveDisabled && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saveDisabled}
          activeOpacity={0.85}
        >
          {saving ? <ActivityIndicator color={colors.textOnAccent} /> : <Text style={styles.saveButtonText}>Save</Text>}
        </TouchableOpacity>
      </View>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, ...shadow.md },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
  },
  prefix: { fontSize: 16, color: colors.textSecondary, fontWeight: '600', marginRight: 2 },
  input: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.textPrimary },
  helper: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  statusText: { fontSize: 13, marginLeft: 6, fontWeight: '500' },
  saveButton: {
    backgroundColor: colors.accent, borderRadius: radii.pill,
    paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg,
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: colors.textOnAccent, fontWeight: '600', fontSize: 15 },
});
