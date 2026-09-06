import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, shadow } from '../theme';

const SETTINGS_ROWS = [
  { key: 'account', label: 'Account', icon: 'person-circle-outline' },
  { key: 'privacy', label: 'Privacy', icon: 'lock-closed-outline' },
  { key: 'chats', label: 'Chats', icon: 'chatbubbles-outline' },
  { key: 'appearance', label: 'Appearance', icon: 'color-palette-outline' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications-outline' },
  { key: 'invite', label: 'Invite a Friend', icon: 'people-outline' },
];

export default function SettingsScreen({
  currentUser, onBack, onOpenProfile, onOpenSection, onLogout
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <TouchableOpacity style={styles.profileCard} onPress={onOpenProfile} activeOpacity={0.7}>
          {currentUser?.profilePicture ? (
            <Image source={{ uri: currentUser.profilePicture }} style={styles.profileAvatarImage} />
          ) : (
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>
                {(currentUser?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={styles.profileName}>{currentUser?.name || 'Your profile'}</Text>
            <Text style={styles.profileSubtitle}>Tap to edit profile photo and details</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.rowsCard}>
          {SETTINGS_ROWS.map((row, idx) => (
            <TouchableOpacity
              key={row.key}
              style={[styles.row, idx === SETTINGS_ROWS.length - 1 && styles.rowLast]}
              onPress={() => onOpenSection(row.key)}
              activeOpacity={0.6}
            >
              <Ionicons name={row.icon} size={22} color={colors.accent} style={{ marginRight: spacing.md }} />
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={onLogout} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
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

  profileCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radii.md,
    margin: spacing.lg, padding: spacing.lg, ...shadow.md
  },
  profileAvatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  profileAvatarImage: { width: 56, height: 56, borderRadius: 28 },
  profileAvatarText: { color: colors.textOnAccent, fontSize: 22, fontWeight: '600' },
  profileName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  profileSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  rowsCard: {
    backgroundColor: colors.surface, borderRadius: radii.md,
    marginHorizontal: spacing.lg, ...shadow.md
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderBottomWidth: 1, borderBottomColor: colors.divider
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },

  logoutButton: {
    marginTop: spacing.xl, marginHorizontal: spacing.lg,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.danger,
    borderRadius: radii.sm, padding: spacing.md, alignItems: 'center'
  },
  logoutText: { color: colors.danger, fontSize: 16, fontWeight: '600' }
});
