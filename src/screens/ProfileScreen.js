import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { updateProfilePicture } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import ImageViewerModal from '../components/ImageViewerModal';

export default function ProfileScreen({ token, currentUser, onBack, onLogout, onProfilePictureUpdated }) {
  const [uploading, setUploading] = useState(false);
  const [localPicture, setLocalPicture] = useState(currentUser?.profilePicture || null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const changePicture = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need access to your photos.');
        return;
      }
      // Gallery only - no launchCameraAsync here. `allowsEditing: true` is
      // expo-image-picker's built-in crop UI (shown after selection, before
      // this resolves), so no separate crop library is needed. `quality: 1`
      // keeps the full-size cropped original - not a downscaled thumbnail.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
        base64: true,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Error', 'Could not read the selected image.');
        return;
      }

      // The backend stores the data URI verbatim in a TEXT column and the
      // REST JSON body limit is 8 MB. Reject oversized images up front with a
      // clear message instead of letting the request fail cryptically.
      if (asset.base64.length > 7 * 1024 * 1024) {
        Alert.alert('Photo too large', 'That image is too big. Please pick a smaller one.');
        return;
      }

      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      setUploading(true);
      await updateProfilePicture(token, dataUri);
      setLocalPicture(dataUri);
      onProfilePictureUpdated?.(dataUri);
      Alert.alert('Updated', 'Profile picture updated.');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setUploading(false);
    }
  };

  // Tapping the avatar views it full-screen; if there's no photo yet, fall
  // through to the picker so the avatar is still a way to add one.
  const handleAvatarPress = () => {
    if (localPicture) setViewerOpen(true);
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
          {localPicture ? (
            <Image source={{ uri: localPicture }} style={styles.avatarImage} />
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
        visible={viewerOpen && !!localPicture}
        uri={localPicture}
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
