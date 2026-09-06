import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';

// Shared shell for every Settings sub-screen (Account, Privacy, Chats,
// Appearance, Notifications, Invite a Friend). Keeping the header/back-button
// implementation in exactly one place means a future styling change only
// has to happen here, not six times.
export default function SettingsSubScreenLayout({ title, onBack, children }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {children}
      </ScrollView>
    </View>
  );
}

export function ComingSoonPlaceholder({ text }) {
  return (
    <View style={styles.comingSoon}>
      <Ionicons name="construct-outline" size={32} color={colors.textMuted} style={{ marginBottom: spacing.md }} />
      <Text style={styles.comingSoonTitle}>Coming soon</Text>
      <Text style={styles.comingSoonText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  content: { padding: spacing.lg },
  comingSoon: { alignItems: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  comingSoonTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  comingSoonText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' }
});
