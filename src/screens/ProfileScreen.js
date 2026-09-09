import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Alert, ActivityIndicator,
  Modal, Share, Platform, ScrollView
} from 'react-native';
import { colors, spacing, radii, shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import ImageViewerModal from '../components/ImageViewerModal';

const MONO = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

export default function ProfileScreen({ token, currentUser, onBack, onLogout, onChangeProfilePicture }) {
  const [uploading, setUploading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  // Displayed picture comes straight from currentUser: App.js owns the picker
  // + upload and pushes the new data URI down through that prop.
  const picture = currentUser?.profilePicture || null;
  const phone = currentUser?.phoneNumber || null;
  const initial = (currentUser?.name || '?').charAt(0).toUpperCase();

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

  // Only ever shares the logged-in user's OWN details - never another user's.
  const shareProfile = async () => {
    try {
      await Share.share({
        title: 'Wave Chat',
        message: 'Hey! Chat with me on Wave. My number: ' + (phone || ''),
      });
    } catch (e) {
      // user dismissed the share sheet, or it is unavailable - nothing to do
    }
  };

  const shareNumber = async () => {
    if (!phone) return;
    try {
      await Share.share({ title: 'Wave Chat', message: phone });
    } catch (e) {
      /* dismissed / unavailable */
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

      <View style={styles.avatarWrap}>
        <TouchableOpacity onPress={handleAvatarPress} disabled={uploading} activeOpacity={0.8}>
          {picture ? (
            <Image source={{ uri: picture }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
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
          <Text style={styles.value}>{phone || 'Not set'}</Text>
        </View>
      </View>

      <View style={[styles.card, styles.menuCard]}>
        <TouchableOpacity style={styles.menuRow} onPress={shareProfile} activeOpacity={0.6}>
          <Ionicons name="share-social-outline" size={20} color={colors.textSecondary} style={styles.menuIcon} />
          <Text style={styles.menuLabel}>Share Profile</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.menuRow} onPress={() => setQrOpen(true)} activeOpacity={0.6}>
          <Ionicons name="qr-code-outline" size={20} color={colors.textSecondary} style={styles.menuIcon} />
          <Text style={styles.menuLabel}>My QR Code</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={onLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>

      <ImageViewerModal
        visible={viewerOpen && !!picture}
        uri={picture}
        onClose={() => setViewerOpen(false)}
      />

      <Modal visible={qrOpen} animationType="slide" onRequestClose={() => setQrOpen(false)}>
        <ScrollView
          style={styles.qrScreen}
          contentContainerStyle={styles.qrContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.qrClose} onPress={() => setQrOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-outline" size={28} color={colors.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.qrTitle}>My Wave Code</Text>

          {picture ? (
            <Image source={{ uri: picture }} style={styles.qrAvatar} />
          ) : (
            <View style={styles.qrAvatarFallback}>
              <Text style={styles.qrAvatarInitial}>{initial}</Text>
            </View>
          )}
          <Text style={styles.qrName}>{currentUser?.name || 'You'}</Text>

          <View style={styles.qrFrame}>
            <View style={[styles.qrCorner, styles.qrCornerTL]} />
            <View style={[styles.qrCorner, styles.qrCornerTR]} />
            <View style={[styles.qrCorner, styles.qrCornerBL]} />
            <View style={[styles.qrCorner, styles.qrCornerBR]} />
            <Text style={styles.qrNumber}>{phone || 'Not set'}</Text>
          </View>

          <Text style={styles.qrSubtitle}>
            Share your code so others can find you on Wave
          </Text>

          <TouchableOpacity style={styles.qrShareBtn} onPress={shareNumber} activeOpacity={0.85}>
            <Ionicons name="share-social-outline" size={18} color={colors.textOnAccent} style={{ marginRight: spacing.sm }} />
            <Text style={styles.qrShareText}>Share</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
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

  menuCard: { marginTop: spacing.lg },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  menuIcon: { marginRight: spacing.md },
  menuLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },

  logoutButton: {
    marginTop: spacing.xl, marginHorizontal: spacing.lg,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.danger,
    borderRadius: radii.sm, padding: spacing.md, alignItems: 'center'
  },
  logoutText: { color: colors.danger, fontSize: 16, fontWeight: '600' },

  // --- My QR Code modal ---
  qrScreen: { flex: 1, backgroundColor: colors.background },
  qrContent: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: 64, paddingBottom: spacing.xxl },
  qrClose: { position: 'absolute', top: 48, right: 16, padding: 6, zIndex: 2 },
  qrTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  qrAvatar: { width: 80, height: 80, borderRadius: 40 },
  qrAvatarFallback: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center'
  },
  qrAvatarInitial: { color: colors.textOnAccent, fontSize: 32, fontWeight: '700' },
  qrName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },

  qrFrame: {
    width: 240, height: 240, alignItems: 'center', justifyContent: 'center',
    marginVertical: spacing.xl,
  },
  qrCorner: { position: 'absolute', width: 46, height: 46, borderColor: colors.accent },
  qrCornerTL: { top: 0, left: 0, borderLeftWidth: 3, borderTopWidth: 3 },
  qrCornerTR: { top: 0, right: 0, borderRightWidth: 3, borderTopWidth: 3 },
  qrCornerBL: { bottom: 0, left: 0, borderLeftWidth: 3, borderBottomWidth: 3 },
  qrCornerBR: { bottom: 0, right: 0, borderRightWidth: 3, borderBottomWidth: 3 },
  qrNumber: {
    fontFamily: MONO, fontSize: 22, fontWeight: '700', letterSpacing: 1,
    color: colors.textPrimary, textAlign: 'center', paddingHorizontal: spacing.lg,
  },

  qrSubtitle: {
    fontSize: 13, color: colors.textSecondary, textAlign: 'center',
    marginBottom: spacing.xxl, paddingHorizontal: spacing.lg,
  },
  qrShareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent, borderRadius: radii.pill,
    paddingVertical: spacing.md, paddingHorizontal: spacing.xxl,
  },
  qrShareText: { color: colors.textOnAccent, fontSize: 15, fontWeight: '700' },
});
