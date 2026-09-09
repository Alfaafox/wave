import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, RefreshControl, Image, ScrollView
} from 'react-native';
import {
  getConversations, startConversation, createGroup, deleteConversation,
  markAllConversationsRead, archiveConversation, getArchivedConversations,
} from '../utils/api';
import { connectSocket } from '../utils/socket';
import { colors, spacing, radii, typography, shadow } from '../theme';
import ContactPickerScreen from './ContactPickerScreen';
import ConversationRow from '../components/ConversationRow';
import { Ionicons } from '@expo/vector-icons';
import { getFavourites } from '../utils/favourites';

export default function ChatListScreen({ token, currentUser, presenceMap, onOpenChat, onLogout, onOpenProfile, onOpenStarred, onOpenArchived }) {
  const [conversations, setConversations] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [pickerMode, setPickerMode] = useState(null);
  const [groupNamingFor, setGroupNamingFor] = useState(null);
  const [groupNameInput, setGroupNameInput] = useState('');
  const [favouriteIds, setFavouriteIds] = useState([]);
  const [archivedCount, setArchivedCount] = useState(0);

  const loadFavourites = useCallback(() => {
    getFavourites().then(setFavouriteIds).catch(() => {});
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const data = await getConversations(token);
      setConversations(data);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }, [token]);

  // The archived count drives the "Archived" row at the bottom of the list.
  // Re-read it whenever an archive/unarchive happens (locally or via socket).
  const refreshArchivedCount = useCallback(() => {
    getArchivedConversations(token)
      .then((list) => setArchivedCount(Array.isArray(list) ? list.length : 0))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    loadConversations();
    loadFavourites();
    refreshArchivedCount();
    const socket = connectSocket(token);
    // Presence (online dots) is owned by App.js via `presenceMap` - see there.
    const refreshOnActivity = () => loadConversations();
    const handleArchived = ({ conversationId }) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      refreshArchivedCount();
    };
    const handleUnarchived = () => {
      // The conversation (and its latest message) come back via a full refetch.
      loadConversations();
      refreshArchivedCount();
    };

    socket.on('message', refreshOnActivity);
    socket.on('read', refreshOnActivity);
    socket.on('delivered', refreshOnActivity);
    socket.on('conversationActivity', refreshOnActivity);
    socket.on('conversationArchived', handleArchived);
    socket.on('conversationUnarchived', handleUnarchived);

    return () => {
      socket.off('message', refreshOnActivity);
      socket.off('read', refreshOnActivity);
      socket.off('delivered', refreshOnActivity);
      socket.off('conversationActivity', refreshOnActivity);
      socket.off('conversationArchived', handleArchived);
      socket.off('conversationUnarchived', handleUnarchived);
    };
  }, [loadConversations, loadFavourites, refreshArchivedCount, token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    loadFavourites();
    refreshArchivedCount();
    await loadConversations();
    setRefreshing(false);
  };

  const handleArchive = async (item) => {
    const prev = conversations;
    setConversations((cur) => cur.filter((c) => c.id !== item.id));
    setArchivedCount((n) => n + 1);
    try {
      await archiveConversation(token, item.id);
      refreshArchivedCount();
    } catch (err) {
      setConversations(prev);
      refreshArchivedCount();
      Alert.alert('Could not archive', err.message);
    }
  };

  const handleRowLongPress = (item) => {
    const title = item.is_group ? item.name : item.with?.name;
    Alert.alert(title || 'Chat', undefined, [
      { text: 'Archive', onPress: () => handleArchive(item) },
      { text: 'Delete chat', style: 'destructive', onPress: () => handleDeleteChat(item) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Header overflow menu. New Group and Settings reuse the exact handlers the
  // rest of the screen already uses; Starred / Archived are stubs for the next
  // task. Every item closes the menu.
  const handleMarkAllRead = async () => {
    setMenuOpen(false);
    try {
      await markAllConversationsRead(token);
      // Server bumped every membership pointer to the newest message; mirror
      // that locally so the unread badges clear without a round-trip.
      setConversations((prev) => prev.map((c) => ({ ...c, unreadCount: 0 })));
    } catch (err) {
      Alert.alert('Could not mark all as read', err.message);
    }
  };

  const menuAction = (fn) => () => {
    setMenuOpen(false);
    if (typeof fn === 'function') fn();
  };

  const openChatPicker = () => {
    setComposeOpen(false);
    setPickerMode('chat');
  };

  const openGroupPicker = () => {
    setComposeOpen(false);
    setPickerMode('group');
  };

  const closePicker = () => {
    setPickerMode(null);
  };

  const handlePickedUserForChat = async (user) => {
    if (!user.phone) {
      Alert.alert('Missing phone number', 'This contact has no phone number on record.');
      return;
    }
    setPickerMode(null);
    setStarting(true);
    try {
      const result = await startConversation(token, user.phone);
      await loadConversations();
      onOpenChat({ conversationId: result.conversationId, otherUser: result.with, isGroup: false });
    } catch (err) {
      Alert.alert('Could not start chat', err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleGroupSelectionConfirmed = (selectedUsers) => {
    setPickerMode(null);
    setGroupNamingFor(selectedUsers);
    setGroupNameInput('');
  };

  const handleCreateGroupFromPicker = async () => {
    if (!groupNameInput.trim() || !groupNamingFor || groupNamingFor.length === 0) return;
    setStarting(true);
    try {
      const phones = groupNamingFor.map((u) => u.phone).filter(Boolean);
      if (phones.length === 0) {
        Alert.alert('No valid numbers', 'None of the selected contacts have a phone number on record.');
        setStarting(false);
        return;
      }
      const result = await createGroup(token, groupNameInput.trim(), phones);
      setGroupNamingFor(null);
      await loadConversations();
      onOpenChat({ conversationId: result.conversationId, isGroup: true, groupName: result.name });
    } catch (err) {
      Alert.alert('Could not create group', err.message);
    } finally {
      setStarting(false);
    }
  };

  const handleDeleteChat = (item) => {
    const title = item.is_group ? item.name : item.with?.name;
    Alert.alert(
      'Delete chat',
      `Remove this chat with ${title}? This only deletes it for you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversation(token, item.id);
              await loadConversations();
            } catch (err) {
              Alert.alert('Could not delete chat', err.message);
            }
          }
        }
      ]
    );
  };

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((item) => {
      const title = item.is_group ? item.name : item.with?.name;
      return (title || '').toLowerCase().includes(q);
    });
  }, [conversations, searchQuery]);

  // Favourites strip: the 1:1 conversations whose other party is in
  // 'wave_favourites'. Derived from the same conversation list so it always
  // has a fresh name/picture and a conversationId to open.
  const favouriteConversations = useMemo(() => {
    if (!favouriteIds.length) return [];
    return conversations.filter(
      (c) => !c.is_group && c.with?.id != null && favouriteIds.includes(c.with.id)
    );
  }, [conversations, favouriteIds]);

  if (pickerMode) {
    return (
      <ContactPickerScreen
        token={token}
        mode={pickerMode}
        onClose={closePicker}
        onSelectUser={handlePickedUserForChat}
        onConfirmSelection={handleGroupSelectionConfirmed}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Wave</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={onOpenProfile} style={styles.headerIconBtn}>
            {currentUser?.profilePicture ? (
              <Image source={{ uri: currentUser.profilePicture }} style={styles.headerAvatarImage} />
            ) : (
              <View style={styles.headerAvatar}>
                <Text style={styles.headerAvatarText}>
                  {(currentUser?.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.headerIconBtn}>
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {favouriteConversations.length > 0 && (
        <View style={styles.favStrip}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.favStripContent}
          >
            {favouriteConversations.map((c) => (
              <TouchableOpacity
                key={String(c.id)}
                style={styles.favItem}
                activeOpacity={0.7}
                onPress={() => onOpenChat({
                  conversationId: c.id,
                  otherUser: c.with,
                  isGroup: false,
                  groupName: c.name,
                })}
              >
                <View>
                  {c.with.profilePicture ? (
                    <Image source={{ uri: c.with.profilePicture }} style={styles.favAvatarImage} />
                  ) : (
                    <View style={styles.favAvatar}>
                      <Text style={styles.favAvatarText}>
                        {(c.with.name || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.favStarBadge}>
                    <Ionicons name="star" size={10} color="#FFD700" />
                  </View>
                </View>
                <Text style={styles.favName} numberOfLines={1}>{c.with.name || 'Chat'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <FlatList
        data={filteredConversations}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searchQuery ? 'No chats match your search' : 'No chats yet. Tap + to start one.'}
          </Text>
        }
        ListFooterComponent={
          !searchQuery && archivedCount > 0 ? (
            <TouchableOpacity style={styles.archivedRow} activeOpacity={0.6} onPress={onOpenArchived}>
              <Ionicons name="archive-outline" size={18} color={colors.textMuted} style={styles.archivedIcon} />
              <Text style={styles.archivedLabel}>Archived</Text>
              <View style={styles.archivedBadge}>
                <Text style={styles.archivedBadgeText}>{archivedCount}</Text>
              </View>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            presenceMap={presenceMap}
            onPress={() => onOpenChat({
              conversationId: item.id,
              otherUser: item.with,
              isGroup: !!item.is_group,
              groupName: item.name,
            })}
            onLongPress={() => handleRowLongPress(item)}
          />
        )}
      />

      <TouchableOpacity style={styles.fab} onPress={() => setComposeOpen(true)} activeOpacity={0.85}>
        <Ionicons name="create-outline" size={24} color={colors.textOnAccent} />
      </TouchableOpacity>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuDropdown}>
            <TouchableOpacity style={styles.menuItem} onPress={menuAction(openGroupPicker)}>
              <Ionicons name="people-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>New Group</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={handleMarkAllRead}>
              <Ionicons name="checkmark-done-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>Mark All as Read</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={menuAction(onOpenStarred)}>
              <Ionicons name="star-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>Starred Messages</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={menuAction(onOpenArchived)}>
              <Ionicons name="archive-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>Archived</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItem} onPress={menuAction(onOpenProfile)}>
              <Ionicons name="settings-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>Settings</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <TouchableOpacity style={styles.composeOverlay} activeOpacity={1} onPress={() => setComposeOpen(false)}>
          <View style={styles.composeSheet}>
            <TouchableOpacity style={styles.composeItem} onPress={openChatPicker}>
              <Ionicons name="chatbubble-outline" size={18} color={colors.textPrimary} style={{ marginRight: spacing.md }} />
              <Text style={styles.composeText}>New chat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.composeItem} onPress={openGroupPicker}>
              <Ionicons name="people-outline" size={18} color={colors.textPrimary} style={{ marginRight: spacing.md }} />
              <Text style={styles.composeText}>New group</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={!!groupNamingFor} transparent animationType="slide" onRequestClose={() => setGroupNamingFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Name your group</Text>
            <Text style={styles.modalSubtitle}>
              {groupNamingFor?.length || 0} member{(groupNamingFor?.length || 0) === 1 ? '' : 's'} selected
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              value={groupNameInput}
              onChangeText={setGroupNameInput}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity onPress={() => setGroupNamingFor(null)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateGroupFromPicker} style={styles.modalConfirm} disabled={starting}>
                <Text style={styles.modalConfirmText}>{starting ? 'Creating...' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.sm,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  headerTitle: { ...typography.headerTitle, color: colors.textPrimary },
  headerIconBtn: { marginLeft: spacing.md, padding: 2 },
  headerAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center'
  },
  headerAvatarImage: { width: 32, height: 32, borderRadius: 16 },
  headerAvatarText: { color: colors.textOnAccent, fontSize: 14, fontWeight: '700' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    borderRadius: radii.pill, paddingHorizontal: spacing.md, height: 40
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  favStrip: {
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    paddingVertical: spacing.sm,
  },
  favStripContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  favItem: { alignItems: 'center', width: 60 },
  favAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
  favAvatarImage: { width: 52, height: 52, borderRadius: 26 },
  favAvatarText: { color: colors.textOnAccent, fontSize: 20, fontWeight: '600' },
  favStarBadge: {
    position: 'absolute', top: -2, right: -2,
    width: 16, height: 16, borderRadius: 8, backgroundColor: colors.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.divider,
  },
  favName: { marginTop: 4, fontSize: 11, color: colors.textSecondary, textAlign: 'center' },

  empty: { textAlign: 'center', marginTop: 60, color: colors.textMuted },

  // "Archived" row pinned to the bottom of the main list (footer).
  archivedRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.divider,
    backgroundColor: colors.surface,
  },
  archivedIcon: { marginRight: spacing.md },
  archivedLabel: { flex: 1, fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
  archivedBadge: {
    backgroundColor: colors.border, borderRadius: radii.pill, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  archivedBadgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },

  fab: {
    position: 'absolute', bottom: 28, right: 20, width: 56, height: 56,
    borderRadius: 28, backgroundColor: colors.accent, justifyContent: 'center',
    alignItems: 'center', ...shadow.md
  },

  menuOverlay: { flex: 1, backgroundColor: 'transparent' },
  menuDropdown: {
    position: 'absolute', top: 88, right: spacing.lg,
    minWidth: 216, backgroundColor: colors.background,
    borderRadius: radii.md, paddingVertical: spacing.xs, ...shadow.md,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: spacing.lg },
  menuItemText: { fontSize: 15, color: colors.textPrimary, marginLeft: spacing.md },

  composeOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  composeSheet: {
    backgroundColor: colors.background, margin: spacing.lg, marginBottom: 100,
    borderRadius: radii.md, paddingVertical: spacing.sm, ...shadow.md
  },
  composeItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.lg },
  composeText: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: colors.background, padding: spacing.lg,
    borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md
  },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 4, color: colors.textPrimary },
  modalSubtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  modalInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: spacing.md, fontSize: 16, color: colors.textPrimary
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.lg },
  modalCancel: { padding: spacing.md, marginRight: spacing.sm },
  modalCancelText: { color: colors.textSecondary, fontWeight: '500' },
  modalConfirm: {
    backgroundColor: colors.accent, paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl, borderRadius: radii.sm
  },
  modalConfirmText: { color: colors.textOnAccent, fontWeight: '600' }
});
