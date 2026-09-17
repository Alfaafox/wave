// src/screens/JoinGroupScreen.js
//
// Landing screen for a group invite link (wave://join/TOKEN or
// https://waveitchat.com/join/TOKEN, see App.js's handleDeepLink). Fetches a
// public preview via GET /conversations/join/:token (no auth - anyone with
// the link can see what they're being invited to), then lets the signed-in
// user join via POST /conversations/join/:token (joinGroupByToken).
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getGroupJoinPreview, joinGroupByToken } from '../utils/api';
import { colors, spacing, radii, typography, shadow } from '../theme';

const ICON_SIZE = 80;

function GroupIcon({ uri, name }) {
  return uri ? (
    <Image source={{ uri }} style={styles.icon} />
  ) : (
    <View style={[styles.icon, styles.iconFallback]}>
      <Text style={styles.iconFallbackText}>{(name || '?').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function JoinGroupScreen({ token, inviteToken, onJoined, onBack }) {
  const [state, setState] = useState('loading'); // loading | preview | invalid | member | error
  const [preview, setPreview] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const loadPreview = useCallback(async () => {
    if (!inviteToken) {
      setState('invalid');
      return;
    }
    setState('loading');
    setJoinError('');
    try {
      const data = await getGroupJoinPreview(inviteToken);
      setPreview(data);
      setState('preview');
    } catch (err) {
      const msg = err.message || '';
      if (/invalid|expired/i.test(msg)) {
        setState('invalid');
      } else {
        setErrorMsg(msg || 'Could not load this invite.');
        setState('error');
      }
    }
  }, [inviteToken]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const handleJoin = async () => {
    if (!token) {
      setJoinError('Log in to join this group.');
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const result = await joinGroupByToken(token, inviteToken);
      onJoined({ conversationId: result.conversationId, name: result.name });
    } catch (err) {
      const msg = err.message || '';
      if (/already/i.test(msg)) {
        setState('member');
      } else if (/blocked/i.test(msg)) {
        setJoinError("You've been blocked from this group.");
      } else if (/full|limit/i.test(msg)) {
        setJoinError('This group is full.');
      } else {
        setJoinError(msg || 'Could not join this group. Try again.');
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.content}>
        {state === 'loading' && (
          <ActivityIndicator size="large" color={colors.accent} />
        )}

        {state === 'invalid' && (
          <>
            <Ionicons name="link-outline" size={56} color={colors.textMuted} />
            <Text style={styles.title}>This invite link is invalid or has expired</Text>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
            <Text style={styles.title}>Could not load this invite</Text>
            <Text style={styles.subtitle}>{errorMsg}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={loadPreview}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'member' && (
          <>
            {/* preview was already fetched successfully before the join
                attempt told us we're already a member, so it still has the
                conversation id/name we need to open the chat - the failed
                POST /conversations/join/:token itself returns no body. */}
            <GroupIcon uri={preview?.icon} name={preview?.name} />
            <Text style={styles.title}>You're already in this group</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => onJoined({ conversationId: preview?.id, name: preview?.name })}
            >
              <Text style={styles.primaryBtnText}>Open Chat</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'preview' && preview && (
          <>
            <GroupIcon uri={preview.icon} name={preview.name} />
            <Text style={styles.groupName}>{preview.name || 'Group'}</Text>
            <Text style={styles.subtitle}>
              {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
              {preview.description ? ` - ${preview.description}` : ''}
            </Text>

            <TouchableOpacity
              style={[styles.primaryBtn, joining && styles.primaryBtnDisabled]}
              onPress={handleJoin}
              disabled={joining}
            >
              {joining ? (
                <ActivityIndicator size="small" color={colors.textOnAccent} />
              ) : (
                <Text style={styles.primaryBtnText}>Join Group</Text>
              )}
            </TouchableOpacity>

            {!!joinError && <Text style={styles.errorText}>{joinError}</Text>}

            <Text style={styles.footnote}>You were invited to join this group</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  backBtn: { paddingTop: 50, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },

  icon: { width: ICON_SIZE, height: ICON_SIZE, borderRadius: ICON_SIZE / 2, marginBottom: spacing.lg },
  iconFallback: { backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  iconFallbackText: { color: colors.textOnAccent, fontWeight: '700', fontSize: ICON_SIZE * 0.4 },

  groupName: { ...typography.headerTitle, color: colors.textPrimary, textAlign: 'center' },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md },
  subtitle: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    marginTop: spacing.xs, marginBottom: spacing.xl,
  },

  primaryBtn: {
    backgroundColor: colors.accent, borderRadius: radii.pill,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl,
    minWidth: 200, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.md, ...shadow.sm,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: colors.textOnAccent, fontSize: 16, fontWeight: '700' },

  secondaryBtn: { marginTop: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  secondaryBtnText: { color: colors.accent, fontSize: 15, fontWeight: '600' },

  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
  footnote: { color: colors.textMuted, fontSize: 13, marginTop: spacing.xl, textAlign: 'center' },
});
