import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert, ActivityIndicator, Image, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SettingsSubScreenLayout from '../components/SettingsSubScreenLayout';
import { getPrivacySettings, updatePrivacySettings, unblockUser } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';

export default function PrivacySettingsScreen({ token, onBack }) {
  const [loading, setLoading] = useState(true);
  const [lastSeenVisible, setLastSeenVisible] = useState(true);
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [whoCanAddToGroups, setWhoCanAddToGroups] = useState('everyone');
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [savingField, setSavingField] = useState(null);
  const [unblockingId, setUnblockingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getPrivacySettings(token);
      setLastSeenVisible(data.lastSeenVisible);
      setReadReceiptsEnabled(data.readReceiptsEnabled);
      setWhoCanAddToGroups(data.whoCanAddToGroups);
      setBlockedUsers(data.blockedUsers || []);
    } catch (err) {
      Alert.alert('Could not load privacy settings', err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleLastSeen = async (value) => {
    setSavingField('lastSeen');
    const previous = lastSeenVisible;
    setLastSeenVisible(value);
    try {
      await updatePrivacySettings(token, { lastSeenVisible: value });
    } catch (err) {
      setLastSeenVisible(previous);
      Alert.alert('Could not update', err.message);
    } finally {
      setSavingField(null);
    }
  };

  const handleToggleReadReceipts = async (value) => {
    setSavingField('readReceipts');
    const previous = readReceiptsEnabled;
    setReadReceiptsEnabled(value);
    try {
      await updatePrivacySettings(token, { readReceiptsEnabled: value });
    } catch (err) {
      setReadReceiptsEnabled(previous);
      Alert.alert('Could not update', err.message);
    } finally {
      setSavingField(null);
    }
  };

  const handleToggleWhoCanAdd = async (value) => {
    const newSetting = value ? 'everyone' : 'nobody';
    setSavingField('whoCanAdd');
    const previous = whoCanAddToGroups;
    setWhoCanAddToGroups(newSetting);
    try {
      await updatePrivacySettings(token, { whoCanAddToGroups: newSetting });
    } catch (err) {
      setWhoCanAddToGroups(previous);
      Alert.alert('Could not update', err.message);
    } finally {
      setSavingField(null);
    }
  };

  const handleUnblock = (user) => {
    Alert.alert('Unblock ' + user.name + '?', 'They will be able to message you again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        style: 'destructive',
        onPress: async () => {
          setUnblockingId(user.id);
          try {
            await unblockUser(token, user.id);
            setBlockedUsers((prev) => prev.filter((u) => u.id !== user.id));
          } catch (err) {
            Alert.alert('Could not unblock', err.message);
          } finally {
            setUnblockingId(null);
          }
        }
      }
    ]);
  };

  if (loading) {
    return (
      <SettingsSubScreenLayout title="Privacy" onBack={onBack}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xxl }} />
      </SettingsSubScreenLayout>
    );
  }

  return (
    <SettingsSubScreenLayout title="Privacy" onBack={onBack}>
      <Text style={styles.sectionLabel}>Last Seen</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Show my last seen and online status</Text>
            <Text style={styles.toggleHint}>Turning this off also hides other people's last seen from you.</Text>
          </View>
          {savingField === 'lastSeen' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch value={lastSeenVisible} onValueChange={handleToggleLastSeen} trackColor={{ false: colors.border, true: colors.accent }} />
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Read Receipts</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.toggleLabel}>Send read receipts</Text>
            <Text style={styles.toggleHint}>Turning this off also hides other people's read receipts from you. Doesn't apply to groups.</Text>
          </View>
          {savingField === 'readReceipts' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch value={readReceiptsEnabled} onValueChange={handleToggleReadReceipts} trackColor={{ false: colors.border, true: colors.accent }} />
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Who Can Add Me to Groups</Text>
      <View style={styles.card}>
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, marginRight: spacing.md }}>
            <Text style={styles.toggleLabel}>{whoCanAddToGroups === 'everyone' ? 'Everyone' : 'Nobody'}</Text>
            <Text style={styles.toggleHint}>Off means nobody can add you to a new group without asking first.</Text>
          </View>
          {savingField === 'whoCanAdd' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch
              value={whoCanAddToGroups === 'everyone'}
              onValueChange={handleToggleWhoCanAdd}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          )}
        </View>
      </View>

      <Text style={styles.sectionLabel}>Blocked Contacts</Text>
      <View style={styles.card}>
        {blockedUsers.length === 0 ? (
          <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
        ) : (
          <FlatList
            data={blockedUsers}
            keyExtractor={(item) => String(item.id)}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.blockedRow}>
                {item.profilePicture ? (
                  <Image source={{ uri: item.profilePicture }} style={styles.blockedAvatarImage} />
                ) : (
                  <View style={styles.blockedAvatar}>
                    <Text style={styles.blockedAvatarText}>{(item.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <Text style={styles.blockedName}>{item.name}</Text>
                <TouchableOpacity onPress={() => handleUnblock(item)} disabled={unblockingId === item.id}>
                  {unblockingId === item.id ? (
                    <ActivityIndicator size="small" color={colors.danger} />
                  ) : (
                    <Text style={styles.unblockText}>Unblock</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
        <Text style={styles.blockedHint}>
          To block someone new, open their chat and use the menu there - blocking starts from the
          conversation itself, not from this list.
        </Text>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { fontSize: 15, color: colors.textPrimary, marginBottom: 4 },
  toggleHint: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },

  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: spacing.md },
  blockedRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.divider
  },
  blockedAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center', marginRight: spacing.sm
  },
  blockedAvatarImage: { width: 36, height: 36, borderRadius: 18, marginRight: spacing.sm },
  blockedAvatarText: { color: colors.textOnAccent, fontSize: 14, fontWeight: '600' },
  blockedName: { flex: 1, fontSize: 15, color: colors.textPrimary },
  unblockText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  blockedHint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.md, lineHeight: 16 }
});
