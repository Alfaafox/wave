// src/screens/GroupInfoScreen.js
//
// Group management (Session 21) - the group-chat counterpart to
// PrivacySettingsScreen/AccountSettingsScreen, but not part of the Settings
// stack (it's opened from ChatScreen's header menu, so it builds its own
// header instead of reusing SettingsSubScreenLayout, which has no slot for
// a conditional right-side Save button or FlatList/RefreshControl).
//
// Every mutation is optimistic-with-rollback where that's cheap (toggles),
// or a plain loading-state request where it isn't (name/description save,
// member actions) - see each handler. Real-time updates come from the
// group:* socket events routes/conversations.js emits to every member's
// own user:<id> room (not just conversation:<id> - this screen never joins
// that room, only ChatScreen does), so another admin's change shows up here
// live without a pull-to-refresh.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  FlatList, RefreshControl, ActivityIndicator, Alert, Switch,
  Clipboard, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import ContactPickerScreen from './ContactPickerScreen';
import { connectSocket } from '../utils/socket';
import {
  getGroupInfo, updateGroupInfo, addGroupMembers, removeGroupMember,
  promoteGroupMember, demoteGroupMember, leaveGroup, resetGroupInvite,
} from '../utils/api';
import { colors, spacing, radii, typography, shadow } from '../theme';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const ICON_MAX_KB = 500;

function sortMembers(members) {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function formatCreatedAt(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr.replace(' ', 'T') + 'Z').toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

function GroupAvatar({ icon, name, size = 84 }) {
  return icon ? (
    <Image source={{ uri: icon }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarFallbackText, { fontSize: size * 0.4 }]}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function MemberAvatar({ profilePicture, name, size = 44 }) {
  return profilePicture ? (
    <Image source={{ uri: profilePicture }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View style={[styles.memberAvatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.memberAvatarFallbackText}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function SkeletonBlock({ style }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeletonBlock, style, { opacity }]} />;
}

export default function GroupInfoScreen({ token, currentUser, conversationId, onBack, onLeave, onAddMembers }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);

  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [togglingRestricted, setTogglingRestricted] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [resettingInvite, setResettingInvite] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [memberActionId, setMemberActionId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);

  const loadGroupInfo = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getGroupInfo(token, conversationId);
      data.members = sortMembers(data.members || []);
      setGroupInfo(data);
      setNameDraft(data.name || '');
      setDescriptionDraft(data.description || '');
    } catch (err) {
      setError(err.message || 'Could not load group info.');
    } finally {
      setLoading(false);
    }
  }, [token, conversationId]);

  useEffect(() => { loadGroupInfo(); }, [loadGroupInfo]);

  // Real-time updates - see the file header note on why these are on
  // user:<id> rooms, not just conversation:<id>.
  useEffect(() => {
    if (!token) return undefined;
    const socket = connectSocket(token);
    const sameConv = (data) => Number(data.conversationId) === Number(conversationId);

    const onInfoUpdated = (data) => {
      if (!sameConv(data)) return;
      setGroupInfo((prev) => (prev ? { ...prev, ...data } : prev));
    };
    const onMembersAdded = (data) => {
      if (!sameConv(data)) return;
      setGroupInfo((prev) => {
        if (!prev) return prev;
        const existingIds = new Set(prev.members.map((m) => m.id));
        const newOnes = (data.members || []).filter((m) => !existingIds.has(m.id));
        if (!newOnes.length) return prev;
        const members = sortMembers([...prev.members, ...newOnes]);
        return { ...prev, members, memberCount: members.length };
      });
    };
    const onMemberRemoved = (data) => {
      if (!sameConv(data)) return;
      if (data.userId === currentUser?.id) {
        Alert.alert('Removed', 'You were removed from this group.');
        onLeave();
        return;
      }
      setGroupInfo((prev) => {
        if (!prev) return prev;
        const members = prev.members.filter((m) => m.id !== data.userId);
        return { ...prev, members, memberCount: members.length };
      });
    };
    const onMemberPromoted = (data) => {
      if (!sameConv(data)) return;
      if (data.userId === currentUser?.id) {
        // We're admin now - need a real fetch to pick up inviteToken, which
        // the server never sent us before this.
        loadGroupInfo({ silent: true });
        return;
      }
      setGroupInfo((prev) => {
        if (!prev) return prev;
        const members = sortMembers(prev.members.map((m) => (m.id === data.userId ? { ...m, role: 'admin' } : m)));
        return { ...prev, members };
      });
    };
    const onMemberDemoted = (data) => {
      if (!sameConv(data)) return;
      setGroupInfo((prev) => {
        if (!prev) return prev;
        const members = sortMembers(prev.members.map((m) => (m.id === data.userId ? { ...m, role: 'member' } : m)));
        const isAdmin = data.userId === currentUser?.id ? false : prev.isAdmin;
        return { ...prev, members, isAdmin, inviteToken: isAdmin ? prev.inviteToken : undefined };
      });
    };
    const onMemberLeft = (data) => {
      if (!sameConv(data)) return;
      if (data.promotedUserId === currentUser?.id) {
        loadGroupInfo({ silent: true });
        return;
      }
      setGroupInfo((prev) => {
        if (!prev) return prev;
        let members = prev.members.filter((m) => m.id !== data.userId);
        if (data.promotedUserId) {
          members = members.map((m) => (m.id === data.promotedUserId ? { ...m, role: 'admin' } : m));
        }
        members = sortMembers(members);
        return { ...prev, members, memberCount: members.length };
      });
    };

    socket.on('group:infoUpdated', onInfoUpdated);
    socket.on('group:membersAdded', onMembersAdded);
    socket.on('group:memberRemoved', onMemberRemoved);
    socket.on('group:memberPromoted', onMemberPromoted);
    socket.on('group:memberDemoted', onMemberDemoted);
    socket.on('group:memberLeft', onMemberLeft);
    return () => {
      socket.off('group:infoUpdated', onInfoUpdated);
      socket.off('group:membersAdded', onMembersAdded);
      socket.off('group:memberRemoved', onMemberRemoved);
      socket.off('group:memberPromoted', onMemberPromoted);
      socket.off('group:memberDemoted', onMemberDemoted);
      socket.off('group:memberLeft', onMemberLeft);
    };
  }, [token, conversationId, currentUser?.id, onLeave, loadGroupInfo]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadGroupInfo({ silent: true });
    setRefreshing(false);
  };

  const isAdmin = !!groupInfo?.isAdmin;
  const hasPendingEdits = !!groupInfo && (
    nameDraft.trim() !== (groupInfo.name || '') ||
    (descriptionDraft.trim() || null) !== (groupInfo.description || null)
  );

  const handleSaveInfo = async () => {
    if (!hasPendingEdits || savingInfo) return;
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      Alert.alert('Name required', 'Group name cannot be empty.');
      return;
    }
    const payload = {};
    if (trimmedName !== (groupInfo.name || '')) payload.name = trimmedName;
    const trimmedDesc = descriptionDraft.trim() || null;
    if (trimmedDesc !== (groupInfo.description || null)) payload.description = trimmedDesc;

    setSavingInfo(true);
    try {
      const updated = await updateGroupInfo(token, conversationId, payload);
      setGroupInfo((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      Alert.alert('Could not save', err.message || 'Try again.');
    } finally {
      setSavingInfo(false);
    }
  };

  const handleToggleRestricted = async (value) => {
    const previous = groupInfo.messagesRestricted;
    setGroupInfo((prev) => ({ ...prev, messagesRestricted: value }));
    setTogglingRestricted(true);
    try {
      await updateGroupInfo(token, conversationId, { messages_restricted: value });
    } catch (err) {
      setGroupInfo((prev) => ({ ...prev, messagesRestricted: previous }));
      Alert.alert('Could not update', err.message || 'Try again.');
    } finally {
      setTogglingRestricted(false);
    }
  };

  const handleChangeIcon = async () => {
    if (!isAdmin || iconUploading) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need access to your photos to set a group icon.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.base64) { Alert.alert('Error', 'Could not read the selected image.'); return; }
      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      const approxKb = Math.round((dataUri.length * 0.75) / 1024);
      if (approxKb > ICON_MAX_KB) {
        Alert.alert('Image too large', `About ${approxKb}KB. Max ${ICON_MAX_KB}KB - try a smaller photo.`);
        return;
      }
      setIconUploading(true);
      const updated = await updateGroupInfo(token, conversationId, { icon: dataUri });
      setGroupInfo((prev) => ({ ...prev, ...updated }));
    } catch (err) {
      Alert.alert('Could not update icon', err.message || 'Try again.');
    } finally {
      setIconUploading(false);
    }
  };

  const handleConfirmAddMembers = async (selectedUsers) => {
    setPickerOpen(false);
    if (!selectedUsers || selectedUsers.length === 0) return;
    if (typeof onAddMembers === 'function') onAddMembers(selectedUsers);
    setAddingMembers(true);
    try {
      const result = await addGroupMembers(token, conversationId, selectedUsers.map((u) => u.id));
      await loadGroupInfo({ silent: true });
      const notes = [];
      if (result.restrictedByPrivacy?.length) notes.push(`${result.restrictedByPrivacy.length} couldn't be added (privacy settings)`);
      if (result.notFound?.length) notes.push(`${result.notFound.length} not found`);
      if (result.alreadyMember?.length) notes.push(`${result.alreadyMember.length} already in the group`);
      if (notes.length) Alert.alert('Some members were not added', notes.join('\n'));
    } catch (err) {
      Alert.alert('Could not add members', err.message || 'Try again.');
    } finally {
      setAddingMembers(false);
    }
  };

  const handlePromote = async (member) => {
    setMemberActionId(member.id);
    try {
      await promoteGroupMember(token, conversationId, member.id);
      setGroupInfo((prev) => ({ ...prev, members: sortMembers(prev.members.map((m) => (m.id === member.id ? { ...m, role: 'admin' } : m))) }));
    } catch (err) {
      Alert.alert('Could not promote', err.message || 'Try again.');
    } finally {
      setMemberActionId(null);
    }
  };

  const handleDemote = async (member) => {
    setMemberActionId(member.id);
    try {
      await demoteGroupMember(token, conversationId, member.id);
      setGroupInfo((prev) => ({ ...prev, members: sortMembers(prev.members.map((m) => (m.id === member.id ? { ...m, role: 'member' } : m))) }));
    } catch (err) {
      Alert.alert('Could not demote', err.message || 'Try again.');
    } finally {
      setMemberActionId(null);
    }
  };

  const handleRemove = async (member) => {
    setMemberActionId(member.id);
    try {
      await removeGroupMember(token, conversationId, member.id);
      setGroupInfo((prev) => {
        const members = prev.members.filter((m) => m.id !== member.id);
        return { ...prev, members, memberCount: members.length };
      });
    } catch (err) {
      Alert.alert('Could not remove member', err.message || 'Try again.');
    } finally {
      setMemberActionId(null);
    }
  };

  const confirmRemove = (member) => {
    Alert.alert(
      `Remove ${member.name || 'this member'}?`,
      'They will be removed from the group immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => handleRemove(member) },
      ]
    );
  };

  const handleMemberLongPress = (member) => {
    if (!isAdmin || member.id === currentUser?.id) return;

    if (member.role === 'admin') {
      if (member.id === groupInfo.ownerId) {
        Alert.alert(`${member.name || 'This member'} is the group owner`, 'The group owner cannot be demoted or removed.');
        return;
      }
      Alert.alert(member.name || 'Admin', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove as Admin', onPress: () => handleDemote(member) },
      ]);
      return;
    }

    Alert.alert(member.name || 'Member', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make Admin', onPress: () => handlePromote(member) },
      { text: 'Remove from Group', style: 'destructive', onPress: () => confirmRemove(member) },
    ]);
  };

  const handleResetInvite = () => {
    Alert.alert(
      'Reset invite link?',
      'The old link will stop working immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset', style: 'destructive',
          onPress: async () => {
            setResettingInvite(true);
            try {
              const result = await resetGroupInvite(token, conversationId);
              setGroupInfo((prev) => ({ ...prev, inviteToken: result.inviteToken }));
            } catch (err) {
              Alert.alert('Could not reset link', err.message || 'Try again.');
            } finally {
              setResettingInvite(false);
            }
          }
        }
      ]
    );
  };

  const handleCopyInvite = () => {
    if (!groupInfo?.inviteToken) return;
    Clipboard.setString(`wave://join/${groupInfo.inviteToken}`);
    Alert.alert('Copied', 'Invite link copied to clipboard.');
  };

  const handleLeaveGroup = () => {
    const soleAdmin = isAdmin && groupInfo.members.filter((m) => m.role === 'admin').length === 1 && groupInfo.members.length > 1;
    Alert.alert(
      'Leave group?',
      soleAdmin
        ? 'You are the only admin. Another member will automatically become admin when you leave.'
        : 'You will no longer receive messages from this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await leaveGroup(token, conversationId);
              onLeave();
            } catch (err) {
              Alert.alert('Could not leave group', err.message || 'Try again.');
              setLeaving(false);
            }
          }
        }
      ]
    );
  };

  if (pickerOpen) {
    return (
      <ContactPickerScreen
        token={token}
        mode="group"
        excludeIds={(groupInfo?.members || []).map((m) => m.id)}
        onClose={() => setPickerOpen(false)}
        onConfirmSelection={handleConfirmAddMembers}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Group Info</Text>
        {isAdmin && hasPendingEdits ? (
          savingInfo ? (
            <View style={styles.headerBtn}><ActivityIndicator size="small" color={colors.accent} /></View>
          ) : (
            <TouchableOpacity onPress={handleSaveInfo} style={styles.headerBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.saveText}>Save</Text>
            </TouchableOpacity>
          )
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {loading ? (
        <View style={{ padding: spacing.lg }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            <SkeletonBlock style={{ width: 84, height: 84, borderRadius: 42 }} />
            <SkeletonBlock style={{ width: 160, height: 16, marginTop: spacing.md, borderRadius: 8 }} />
            <SkeletonBlock style={{ width: 100, height: 12, marginTop: spacing.sm, borderRadius: 6 }} />
          </View>
          <SkeletonBlock style={{ height: 60, borderRadius: radii.md, marginBottom: spacing.lg }} />
          <SkeletonBlock style={{ height: 60, borderRadius: radii.md, marginBottom: spacing.lg }} />
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Could not load group info</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadGroupInfo()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groupInfo.members}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View>
              <View style={styles.identityBlock}>
                <TouchableOpacity onPress={handleChangeIcon} disabled={!isAdmin} activeOpacity={isAdmin ? 0.8 : 1}>
                  <GroupAvatar icon={groupInfo.icon} name={groupInfo.name} />
                  {isAdmin && (
                    <View style={styles.avatarEditBadge}>
                      {iconUploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
                    </View>
                  )}
                </TouchableOpacity>

                {isAdmin ? (
                  <TextInput
                    style={styles.nameInput}
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    maxLength={NAME_MAX}
                    placeholder="Group name"
                    placeholderTextColor={colors.textMuted}
                  />
                ) : (
                  <Text style={styles.nameText}>{groupInfo.name}</Text>
                )}
                <Text style={styles.subtitleText}>
                  {groupInfo.memberCount} member{groupInfo.memberCount === 1 ? '' : 's'}
                  {groupInfo.createdAt ? ` - Created ${formatCreatedAt(groupInfo.createdAt)}` : ''}
                </Text>
              </View>

              <Text style={styles.sectionLabel}>Description</Text>
              <View style={styles.card}>
                {isAdmin ? (
                  <TextInput
                    style={styles.descriptionInput}
                    value={descriptionDraft}
                    onChangeText={setDescriptionDraft}
                    maxLength={DESCRIPTION_MAX}
                    placeholder="Add a description"
                    placeholderTextColor={colors.textMuted}
                    multiline
                  />
                ) : (
                  <Text style={groupInfo.description ? styles.descriptionText : styles.descriptionPlaceholder}>
                    {groupInfo.description || 'No description'}
                  </Text>
                )}
              </View>

              {isAdmin && (
                <>
                  <Text style={styles.sectionLabel}>Settings</Text>
                  <View style={styles.card}>
                    <View style={styles.toggleRow}>
                      <Ionicons name="volume-mute-outline" size={20} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />
                      <Text style={styles.toggleLabel}>Only Admins Can Send Messages</Text>
                      {togglingRestricted ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : (
                        <Switch
                          value={!!groupInfo.messagesRestricted}
                          onValueChange={handleToggleRestricted}
                          trackColor={{ false: colors.border, true: colors.accent }}
                        />
                      )}
                    </View>
                  </View>

                  <Text style={styles.sectionLabel}>Invite Link</Text>
                  <View style={styles.card}>
                    <Text style={styles.inviteLinkText} numberOfLines={1}>
                      wave://join/{groupInfo.inviteToken}
                    </Text>
                    <View style={styles.inviteBtnRow}>
                      <TouchableOpacity style={styles.inviteBtn} onPress={handleCopyInvite}>
                        <Ionicons name="copy-outline" size={16} color={colors.accent} />
                        <Text style={styles.inviteBtnText}>Copy Link</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.inviteBtn} onPress={handleResetInvite} disabled={resettingInvite}>
                        {resettingInvite ? (
                          <ActivityIndicator size="small" color={colors.danger} />
                        ) : (
                          <>
                            <Ionicons name="refresh-outline" size={16} color={colors.danger} />
                            <Text style={[styles.inviteBtnText, { color: colors.danger }]}>Reset Link</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}

              <View style={styles.membersHeaderRow}>
                <Text style={[styles.sectionLabel, { marginTop: 0 }]}>
                  {groupInfo.memberCount} Member{groupInfo.memberCount === 1 ? '' : 's'}
                </Text>
                {isAdmin && (
                  <TouchableOpacity
                    style={styles.addMembersBtn}
                    onPress={() => setPickerOpen(true)}
                    disabled={addingMembers}
                  >
                    {addingMembers ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <>
                        <Ionicons name="person-add-outline" size={16} color={colors.accent} />
                        <Text style={styles.addMembersText}>Add Members</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          }
          ListFooterComponent={
            <TouchableOpacity style={styles.leaveBtn} onPress={handleLeaveGroup} disabled={leaving}>
              {leaving ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <>
                  <Ionicons name="log-out-outline" size={18} color={colors.danger} style={{ marginRight: spacing.sm }} />
                  <Text style={styles.leaveBtnText}>Leave Group</Text>
                </>
              )}
            </TouchableOpacity>
          }
          renderItem={({ item }) => {
            const isOwner = item.id === groupInfo.ownerId;
            const isSelf = item.id === currentUser?.id;
            return (
              <TouchableOpacity
                style={styles.memberRow}
                activeOpacity={isAdmin && !isSelf ? 0.6 : 1}
                onLongPress={() => handleMemberLongPress(item)}
                delayLongPress={350}
              >
                <MemberAvatar profilePicture={item.profilePicture} name={item.name} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {isSelf ? 'You' : item.name}
                    </Text>
                    {item.role === 'admin' && (
                      <Ionicons name="ribbon-outline" size={14} color="#D4AF37" style={{ marginLeft: 6 }} />
                    )}
                  </View>
                  {item.role === 'admin' && (
                    <Text style={styles.memberRoleText}>{isOwner ? 'Owner' : 'Admin'}</Text>
                  )}
                </View>
                {memberActionId === item.id && <ActivityIndicator size="small" color={colors.accent} />}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground, borderBottomWidth: 1, borderBottomColor: colors.headerBorder,
  },
  headerBtn: { minWidth: 44, alignItems: 'flex-end' },
  headerTitle: { ...typography.headerTitle, color: colors.textPrimary },
  saveText: { color: colors.accent, fontSize: 16, fontWeight: '700' },

  identityBlock: { alignItems: 'center', paddingVertical: spacing.xl },
  avatarFallback: { backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  avatarFallbackText: { color: colors.textOnAccent, fontWeight: '700' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.background,
    justifyContent: 'center', alignItems: 'center',
  },
  nameText: { ...typography.headerTitle, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center' },
  nameInput: {
    ...typography.headerTitle, color: colors.textPrimary, marginTop: spacing.md, textAlign: 'center',
    borderBottomWidth: 1, borderBottomColor: colors.border, minWidth: 200, paddingVertical: 4,
  },
  subtitleText: { fontSize: 13, color: colors.textSecondary, marginTop: spacing.xs },

  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted,
    textTransform: 'uppercase', marginBottom: spacing.sm, marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.lg,
    marginHorizontal: spacing.lg, ...shadow.sm,
  },
  descriptionText: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  descriptionPlaceholder: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  descriptionInput: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, minHeight: 40, padding: 0 },

  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleLabel: { flex: 1, fontSize: 14, color: colors.textPrimary },

  inviteLinkText: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.md },
  inviteBtnRow: { flexDirection: 'row', gap: spacing.lg },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inviteBtnText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  membersHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: spacing.lg, marginTop: spacing.lg,
  },
  addMembersBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addMembersText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
  },
  memberAvatarFallback: { backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  memberAvatarFallbackText: { color: colors.textOnAccent, fontWeight: '600', fontSize: 15 },
  memberName: { fontSize: 15, color: colors.textPrimary, fontWeight: '500', flexShrink: 1 },
  memberRoleText: { fontSize: 12, color: colors.textMuted, marginTop: 1 },

  leaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.xl, marginBottom: spacing.xxl,
    paddingVertical: spacing.md, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.danger,
  },
  leaveBtnText: { color: colors.danger, fontSize: 15, fontWeight: '700' },

  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },
  emptySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  retryBtn: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: radii.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  retryBtnText: { color: colors.textOnAccent, fontWeight: '600' },

  skeletonBlock: { backgroundColor: colors.surface },
});
