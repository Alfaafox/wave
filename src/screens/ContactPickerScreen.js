import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, Share
} from 'react-native';
import { getMatchedContacts } from '../utils/contactsMatcher';
import { colors, spacing, radii, shadow } from '../theme';

const APP_SHARE_MESSAGE =
  "Hey! I'm using Wave to chat — join me here: https://example.com/wave-app-link";

export default function ContactPickerScreen({
  token,
  mode, // 'chat' | 'group'
  onClose,
  onSelectUser,      // (user) => void, used in 'chat' mode
  onConfirmSelection // (selectedUsers[]) => void, used in 'group' mode
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [registered, setRegistered] = useState([]);
  const [unregistered, setUnregistered] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const { registered, unregistered } = await getMatchedContacts(token);
        registered.sort((a, b) => (a.contactName || '').localeCompare(b.contactName || ''));
        unregistered.sort((a, b) => (a.contactName || '').localeCompare(b.contactName || ''));
        setRegistered(registered);
        setUnregistered(unregistered);
      } catch (err) {
        if (err.code === 'PERMISSION_DENIED') {
          setError('Contacts permission was denied. Enable it in your phone settings to find friends on Wave.');
        } else {
          setError(err.message || 'Could not load contacts.');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const filteredRegistered = useMemo(() => {
    if (!search.trim()) return registered;
    const q = search.trim().toLowerCase();
    return registered.filter((c) => (c.contactName || '').toLowerCase().includes(q));
  }, [registered, search]);

  const filteredUnregistered = useMemo(() => {
    if (!search.trim()) return unregistered;
    const q = search.trim().toLowerCase();
    return unregistered.filter((c) => (c.contactName || '').toLowerCase().includes(q));
  }, [unregistered, search]);

  const toggleSelect = (user) => {
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (next[user.id]) {
        delete next[user.id];
      } else {
        next[user.id] = user;
      }
      return next;
    });
  };

  const handleTapUser = (user) => {
    if (mode === 'chat') {
      onSelectUser(user);
    } else {
      toggleSelect(user);
    }
  };

  const handleInvite = async (contact) => {
    try {
      await Share.share({ message: APP_SHARE_MESSAGE });
    } catch (err) {
      Alert.alert('Could not open share sheet', err.message);
    }
  };

  const selectedCount = Object.keys(selectedIds).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'←'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {mode === 'group' ? 'Select group members' : 'New chat'}
        </Text>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>Finding friends on Wave...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={[
            { type: 'header', key: 'h-registered', label: 'On Wave' },
            ...filteredRegistered.map((c) => ({ type: 'registered', key: `r-${c.id}`, data: c })),
            { type: 'header', key: 'h-unregistered', label: 'Invite to Wave' },
            ...filteredUnregistered.map((c, i) => ({ type: 'unregistered', key: `u-${i}`, data: c }))
          ]}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              if (
                (item.key === 'h-registered' && filteredRegistered.length === 0) ||
                (item.key === 'h-unregistered' && filteredUnregistered.length === 0)
              ) {
                return null;
              }
              return <Text style={styles.sectionHeader}>{item.label}</Text>;
            }

            if (item.type === 'registered') {
              const user = item.data;
              const isSelected = mode === 'group' && !!selectedIds[user.id];
              return (
                <TouchableOpacity style={styles.row} onPress={() => handleTapUser(user)} activeOpacity={0.6}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(user.contactName || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.rowName}>{user.contactName}</Text>
                    {user.contactName !== user.name && (
                      <Text style={styles.rowSub}>{user.name}</Text>
                    )}
                  </View>
                  {mode === 'group' && (
                    <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                      {isSelected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  )}
                </TouchableOpacity>
              );
            }

            const contact = item.data;
            return (
              <View style={styles.row}>
                <View style={[styles.avatar, styles.avatarMuted]}>
                  <Text style={styles.avatarText}>{(contact.contactName || '?').charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.rowName}>{contact.contactName}</Text>
                  <Text style={styles.rowSub}>{contact.phone}</Text>
                </View>
                <TouchableOpacity style={styles.inviteBtn} onPress={() => handleInvite(contact)}>
                  <Text style={styles.inviteBtnText}>Invite</Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No contacts found</Text>}
        />
      )}

      {mode === 'group' && selectedCount > 0 && (
        <TouchableOpacity
          style={styles.confirmBtn}
          onPress={() => onConfirmSelection(Object.values(selectedIds))}
        >
          <Text style={styles.confirmBtnText}>
            Continue with {selectedCount} {selectedCount === 1 ? 'contact' : 'contacts'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground, borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  backArrow: { color: colors.textPrimary, fontSize: 22 },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    borderRadius: radii.pill, paddingHorizontal: spacing.md, height: 40
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm, opacity: 0.5 },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary },
  errorText: { color: colors.textSecondary, textAlign: 'center', fontSize: 15 },

  sectionHeader: {
    fontSize: 13, fontWeight: '700', color: colors.textMuted,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
    textTransform: 'uppercase'
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  avatarMuted: { backgroundColor: colors.textMuted },
  avatarText: { color: colors.textOnAccent, fontSize: 18, fontWeight: '600' },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  rowSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center'
  },
  checkboxSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.textOnAccent, fontSize: 14, fontWeight: '700' },

  inviteBtn: {
    borderWidth: 1, borderColor: colors.accent, borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6
  },
  inviteBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  confirmBtn: {
    backgroundColor: colors.accent, margin: spacing.lg, borderRadius: radii.sm,
    padding: spacing.md, alignItems: 'center', ...shadow.md
  },
  confirmBtnText: { color: colors.textOnAccent, fontSize: 16, fontWeight: '600' },

  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 60 }
});
