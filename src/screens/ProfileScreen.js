import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { updateProfilePicture } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen({ token, currentUser, onBack, onLogout, onProfilePictureUpdated }) {
  const [uploading, setUploading] = useState(false);
  const [localPicture, setLocalPicture] = useState(currentUser?.profilePicture || null);

  const changePicture = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need access to your photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.4,
        base64: true,
        allowsEditing: true,
        aspect: [1, 1]
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.base64) {
        Alert.alert('Error', 'Could not read the selected image.');
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <TouchableOpacity style={styles.avatarWrap} onPress={changePicture} disabled={uploading} activeOpacity={0.8}>
        {localPicture ? (
          <Image source={{ uri: localPicture }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(currentUser?.name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        {uploading ? (
          <ActivityIndicator style={styles.avatarOverlay} color={colors.accent} />
        ) : (
          <Text style={styles.changeText}>Tap to change photo</Text>
        )}
      </TouchableOpacity>

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
  avatarOverlay: { marginTop: spacing.sm },
  changeText: { marginTop: spacing.sm, color: colors.accent, fontSize: 13, fontWeight: '500' },

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
