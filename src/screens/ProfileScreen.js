import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { updateProfilePicture } from '../utils/api';

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
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <TouchableOpacity style={styles.avatarWrap} onPress={changePicture} disabled={uploading}>
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
          <ActivityIndicator style={styles.avatarOverlay} color="#fff" />
        ) : (
          <Text style={styles.changeText}>Tap to change photo</Text>
        )}
      </TouchableOpacity>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{currentUser?.name}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{currentUser?.email}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Phone number</Text>
        <Text style={styles.value}>{currentUser?.phoneNumber || 'Not set'}</Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50,
    backgroundColor: '#075E54'
  },
  backArrow: { color: '#fff', fontSize: 22, marginRight: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  avatarWrap: { alignItems: 'center', marginVertical: 30 },
  avatar: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#075E54',
    justifyContent: 'center', alignItems: 'center'
  },
  avatarImage: { width: 90, height: 90, borderRadius: 45 },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '600' },
  avatarOverlay: { marginTop: 8 },
  changeText: { marginTop: 8, color: '#075E54', fontSize: 13 },
  field: { paddingHorizontal: 24, marginBottom: 20 },
  label: { fontSize: 13, color: '#888', marginBottom: 4 },
  value: { fontSize: 17, color: '#111' },
  logoutButton: {
    marginTop: 30, marginHorizontal: 24, backgroundColor: '#fee',
    borderRadius: 10, padding: 16, alignItems: 'center'
  },
  logoutText: { color: '#d32f2f', fontSize: 16, fontWeight: '600' }
});
