import React, { useState } from 'react';
import { View, Text, StyleSheet, Share, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import WaveButton from '../components/WaveButton';
import { colors, spacing, radii, shadow } from '../theme';

// NOTE: this message currently has no real download link to point people to,
// since Wave isn't published yet - it's a placeholder line. Update this the
// moment you have a real Play Store / App Store listing URL, or a shareable
// EAS build install link if you want to invite testers before launch.
const INVITE_MESSAGE =
  "Join me on Wave! It's a fast, private messaging app. " +
  '(Download link coming soon.)';

export default function InviteFriendScreen({ onBack }) {
  const [sharing, setSharing] = useState(false);

  const handleInvite = async () => {
    try {
      setSharing(true);
      await Share.share({ message: INVITE_MESSAGE });
    } catch (err) {
      Alert.alert('Could not open share sheet', err.message);
    } finally {
      setSharing(false);
    }
  };

  return (
    <SettingsSubScreenLayout title="Invite a Friend" onBack={onBack}>
      <View style={styles.card}>
        <Ionicons name="people-circle-outline" size={56} color={colors.accent} style={{ marginBottom: spacing.md }} />
        <Text style={styles.title}>Bring your friends to Wave</Text>
        <Text style={styles.subtitle}>
          Share Wave with anyone - it opens your phone's normal share menu, so you can send it
          via text, email, or any app you already use.
        </Text>
        <WaveButton
          variant="primary"
          label="Invite a Friend"
          icon="share-social-outline"
          fullWidth
          loading={sharing}
          onPress={handleInvite}
        />
      </View>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.xl,
    alignItems: 'center', ...shadow.md
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 19 },
});
