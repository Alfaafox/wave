import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import { colors, spacing, radii, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import ImageViewerModal from '../components/ImageViewerModal';

export default function ProfileScreen({ token, currentUser, onBack, onLogout, onChangeProfilePicture }) {
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  // Displayed picture comes straight from currentUser: App.js owns the picker
  // + upload and pushes the new data URI down through that prop.
  const picture = currentUser?.profilePicture || null;

  // The actual expo-image-picker call lives at the App.js level, NOT here.
  // On Android (New Architecture) ImagePicker.launchImageLibraryAsync throws
  // "ActivityResultLauncher not registered" when invoked from a component that
  // is mounted inside a <Modal> tree. Delegating to App.js keeps the call out
  // of any Modal context. We only drive the local spinner.
  const changePicture = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      await onChangeProfilePicture?.();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setUploading(false);
    }
  };

  // Tapping the avatar views it full-screen; if there's no photo yet, fall
  // through to the picker so the avatar is still a way to add one.
  const handleAvatarPress = () => {
    if (picture) setViewerOpen(true);
    else changePicture();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.avatarWrap}>
        <TouchableOpacity onPress={handleAvatarPress} disabled={uploading} activeOpacity={0.8}>
          {picture ? (
            <Image source={{ uri: picture }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(currentUser?.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.changeBtn}
          onPress={changePicture}
          disabled={uploading}
          activeOpacity={0.7}
        >
          {uploading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.changeText}>Change profile picture</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{currentUser?.name}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{currentUser?.email}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.field}>
          <Text style={styles.label}>Phone number</Text>
          <Text style={styles.value}>{currentUser?.phoneNumber || 'Not set'}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={onLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      <ImageViewerModal
        visible={viewerOpen && !!picture}
        uri={picture}
        onClose={() => setViewerOpen(false)}
      />
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

  avatarWrap: { alignItems: 'center', marginVertical: spacing.xxl },
  avatar: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  avatarImage: { width: 96, height: 96, borderRadius: 48 },
  avatarText: { color: colors.textOnAccent, fontSize: 38, fontWeight: '600' },
  changeBtn: { marginTop: spacing.md, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, minHeight: 24, justifyContent: 'center' },
  changeText: { color: colors.accent, fontSize: 14, fontWeight: '600' },

  card: {
    marginHorizontal: spacing.lg, backgroundColor: colors.surface,
    borderRadius: radii.md, paddingHorizontal: spacing.lg
  },
  field: { paddingVertical: spacing.md },
  divider: { height: 1, backgroundColor: colors.divider },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  value: { fontSize: 16, color: colors.textPrimary },

  logoutButton: {
    marginTop: spacing.xl, marginHorizontal: spacing.lg,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.danger,
    borderRadius: radii.sm, padding: spacing.md, alignItems: 'center'
  },
  logoutText: { color: colors.danger, fontSize: 16, fontWeight: '600' }
});
