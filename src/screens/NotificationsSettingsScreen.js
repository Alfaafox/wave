import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Switch, ActivityIndicator } from 'react-native';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import { getNotifPrefs, setNotifPref, DEFAULT_NOTIF_PREFS } from '../utils/notifPrefs';
import { applyMessageChannelPrefs } from '../utils/notifications';
import { colors, spacing, radii, shadow } from '../theme';

// Four device-local notification toggles. Nothing here talks to the backend -
// see src/utils/notifPrefs.js for what each one actually affects.
export default function NotificationsSettingsScreen({ onBack, onPrefsChange }) {
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState(DEFAULT_NOTIF_PREFS);

  useEffect(() => {
    (async () => {
      try {
        setPrefs(await getNotifPrefs());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const makeToggle = (name) => async (value) => {
    const next = { ...prefs, [name]: value };
    setPrefs(next);
    onPrefsChange && onPrefsChange(next);
    await setNotifPref(name, value);
    // Sound / Vibration drive the Android 'messages' channel; the other two
    // only change App.js banner behaviour.
    if (name === 'sound' || name === 'vibrate') {
      await applyMessageChannelPrefs();
    }
  };

  if (loading) {
    return (
      <SettingsSubScreenLayout title="Notifications" onBack={onBack}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </SettingsSubScreenLayout>
    );
  }

  return (
    <SettingsSubScreenLayout title="Notifications" onBack={onBack}>
      <Text style={styles.sectionLabel}>Messages</Text>
      <View style={styles.card}>
        <ToggleRow
          label="Message Notifications"
          hint="Show a banner in the app when a new message arrives."
          value={prefs.messages}
          onValueChange={makeToggle('messages')}
        />
        <ToggleRow
          label="Notification Sound"
          hint="Play a sound for new message notifications. Android only."
          value={prefs.sound}
          onValueChange={makeToggle('sound')}
        />
        <ToggleRow
          label="Vibration"
          hint="Vibrate for new message notifications. Android only."
          value={prefs.vibrate}
          onValueChange={makeToggle('vibrate')}
          last
        />
      </View>

      <Text style={styles.sectionLabel}>Calls</Text>
      <View style={styles.card}>
        <ToggleRow
          label="Call Notifications"
          hint="Show a banner for incoming and missed calls."
          value={prefs.calls}
          onValueChange={makeToggle('calls')}
          last
        />
      </View>

      <Text style={styles.note}>
        Mute individual conversations from the chat's profile menu.
      </Text>
    </SettingsSubScreenLayout>
  );
}

function ToggleRow({ label, hint, value, onValueChange, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, paddingHorizontal: spacing.lg, ...shadow.md },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowText: { flex: 1, marginRight: spacing.md },
  rowLabel: { fontSize: 15, color: colors.textPrimary, marginBottom: 4 },
  rowHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  note: { fontSize: 12, color: colors.textMuted, marginTop: spacing.lg, lineHeight: 16 },
});
