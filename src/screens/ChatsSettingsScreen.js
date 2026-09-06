import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, ActivityIndicator, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout, { ComingSoonPlaceholder } from '../components/SettingsSubScreenLayout';
import { colors, spacing, radii, shadow } from '../theme';
import { WALLPAPER_STORAGE_KEY, AUTOSAVE_STORAGE_KEY, WALLPAPER_OPTIONS } from '../utils/chatPreferences';

export default function ChatsSettingsScreen({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [wallpaperId, setWallpaperId] = useState('default');
  const [autoSave, setAutoSave] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedWallpaper, savedAutoSave] = await Promise.all([
          AsyncStorage.getItem(WALLPAPER_STORAGE_KEY),
          AsyncStorage.getItem(AUTOSAVE_STORAGE_KEY),
        ]);
        if (savedWallpaper) setWallpaperId(savedWallpaper);
        if (savedAutoSave != null) setAutoSave(savedAutoSave === 'true');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectWallpaper = async (id) => {
    setWallpaperId(id);
    await AsyncStorage.setItem(WALLPAPER_STORAGE_KEY, id);
  };

  const toggleAutoSave = async (value) => {
    if (value) {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'We need access to your photo library to auto-save images.');
        return;
      }
    }
    setAutoSave(value);
    await AsyncStorage.setItem(AUTOSAVE_STORAGE_KEY, value ? 'true' : 'false');
  };

  if (loading) {
    return (
      <SettingsSubScreenLayout title="Chats" onBack={onBack}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </SettingsSubScreenLayout>
    );
  }

  return (
    <SettingsSubScreenLayout title="Chats" onBack={onBack}>
      <Text style={styles.sectionLabel}>Chat Wallpaper</Text>
      <View style={styles.card}>
        <Text style={styles.hint}>Applies to every chat on this device.</Text>
        <View style={styles.swatchRow}>
          {WALLPAPER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.swatch,
                { backgroundColor: option.color || colors.background },
                wallpaperId === option.id && styles.swatchSelected
              ]}
              onPress={() => selectWallpaper(option.id)}
            >
              {wallpaperId === option.id && (
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              )}
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.labelRow}>
          {WALLPAPER_OPTIONS.map((option) => (
            <Text key={option.id} style={styles.swatchLabel}>{option.label}</Text>
          ))}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Media</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Auto-save received photos</Text>
            <Text style={styles.toggleHint}>Automatically save photos people send you to your gallery.</Text>
          </View>
          <Switch value={autoSave} onValueChange={toggleAutoSave} trackColor={{ false: colors.border, true: colors.accent }} />
        </View>
      </View>

      <Text style={styles.sectionLabel}>Other</Text>
      <View style={styles.card}>
        <ComingSoonPlaceholder text="Font size, archived chats, and exporting a specific chat (found inside that chat's own menu) are coming next." />
      </View>
    </SettingsSubScreenLayout>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.lg
  },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg, ...shadow.md },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  swatchRow: { flexDirection: 'row', justifyContent: 'space-between' },
  swatch: {
    width: 44, height: 44, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center'
  },
  swatchSelected: { borderWidth: 2, borderColor: colors.accent },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  swatchLabel: { fontSize: 9, color: colors.textMuted, width: 44, textAlign: 'center' },

  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { fontSize: 15, color: colors.textPrimary, marginBottom: 4 },
  toggleHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16 }
});
