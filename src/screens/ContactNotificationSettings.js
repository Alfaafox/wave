// src/screens/ContactNotificationSettings.js
//
// Per-contact notification preferences, opened from the "Notifications" row in
// UserProfileModal. Everything is stored device-locally (see
// src/utils/contactPrefs.js) - there is no backend for per-contact prefs.
//
// The mute state is lifted to ChatScreen and passed in as `muted` /
// `onMuteChange` so this screen and the mute toggle in the profile modal
// always agree (spec: "synced with the toggle on the profile modal").

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import { colors, spacing, radii } from '../theme';
import {
  getNotificationPrefs, setNotificationPrefs, DEFAULT_NOTIFICATION_PREFS, VIBRATE_OPTIONS,
} from '../utils/contactPrefs';

export default function ContactNotificationSettings({ onBack, userId, userName, muted, onMuteChange }) {
  const [prefs, setPrefs] = useState(DEFAULT_NOTIFICATION_PREFS);

  useEffect(() => {
    let cancelled = false;
    getNotificationPrefs(userId).then((p) => { if (!cancelled) setPrefs(p); });
    return () => { cancelled = true; };
  }, [userId]);

  const persist = (next) => {
    setPrefs(next);
    setNotificationPrefs(userId, next);
  };

  const setField = (key, value) => persist({ ...prefs, [key]: value });

  const chooseVibrate = () => {
    if (prefs.useDefault) return;
    Alert.alert('Vibrate', undefined, [
      ...VIBRATE_OPTIONS.map((opt) => ({ text: opt, onPress: () => setField('vibrate', opt) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const chooseTone = () => {
    if (prefs.useDefault) return;
    // No custom-tone picker yet - the value is shown and defaults to "Default".
    Alert.alert('Notification tone', 'Custom tones are not available yet. Using the default tone.', [
      { text: 'OK' },
    ]);
  };

  const overridden = !prefs.useDefault;

  return (
    <SettingsSubScreenLayout title="Notifications" onBack={onBack}>
      {!!userName && <Text style={styles.caption}>Notifications for {userName}</Text>}

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Mute notifications</Text>
          <Switch
            value={!!muted}
            onValueChange={(v) => onMuteChange?.(v)}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={chooseTone} disabled={!overridden} activeOpacity={0.6}>
          <Text style={[styles.rowLabel, !overridden && styles.rowLabelDisabled]}>Tone</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowValue, !overridden && styles.rowLabelDisabled]}>{prefs.tone}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <View style={styles.rowDivider} />

        <TouchableOpacity style={styles.row} onPress={chooseVibrate} disabled={!overridden} activeOpacity={0.6}>
          <Text style={[styles.rowLabel, !overridden && styles.rowLabelDisabled]}>Vibrate</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowValue, !overridden && styles.rowLabelDisabled]}>{prefs.vibrate}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity>

        <View style={styles.rowDivider} />

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={[styles.rowLabel, !overridden && styles.rowLabelDisabled]}>Popup notification</Text>
            <Text style={styles.rowHint}>Show the message text instead of just "New message".</Text>
          </View>
          <Switch
            value={!!prefs.popup}
            onValueChange={(v) => setField('popup', v)}
            disabled={!overridden}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.rowLabel}>Use default settings</Text>
            <Text style={styles.rowHint}>When on, this chat uses the app's default notification settings.</Text>
          </View>
          <Switch
            value={!!prefs.useDefault}
            onValueChange={(v) => setField('useDefault', v)}
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>
      </View>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  caption: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, minHeight: 52 },
  rowDivider: { height: 1, backgroundColor: colors.divider },
  rowLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
  rowLabelDisabled: { color: colors.textMuted },
  rowHint: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  rowValue: { fontSize: 14, color: colors.textSecondary, marginRight: spacing.xs },
});
