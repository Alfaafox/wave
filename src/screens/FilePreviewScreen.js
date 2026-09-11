// src/screens/FilePreviewScreen.js
//
// WhatsApp-style confirmation step between "picked a document" and "sent
// it" - ChatScreen no longer uploads the instant pickDocument resolves; it
// stages the picked asset into `fileToConfirm` state and renders this full-
// screen as a conditional overlay (the same `{state && <Screen/>}` pattern
// SharedMediaScreen / ContactNotificationSettings already use - a plain
// absolutely-positioned View, not an RN <Modal>; ViewOnceViewer is the one
// exception in this codebase that wraps itself in a Modal, and that's for
// its own screenshot-blocking reasons, not the convention to follow here).
//
// No navigation library, no new screen in App.js's `screen` state machine -
// same as every other ChatScreen sub-screen.

import React, { useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii, typography } from '../theme';
import { fileIconFor, formatFileSize } from '../utils/fileDisplay';

// file: { uri, name, mimeType, size } - the exact shape
// DocumentPicker.getDocumentAsync() returns per asset, passed straight
// through from ChatScreen's pickDocument with no reshaping.
export default function FilePreviewScreen({ file, sending, onSend, onCancel }) {
  const [caption, setCaption] = useState('');

  const name = file?.name || 'File';
  const sizeLabel = formatFileSize(file?.size);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onCancel}
          disabled={sending}
          style={styles.headerBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={26} color={sending ? colors.textMuted : colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send File</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.center}>
        <Ionicons name={fileIconFor(file?.mimeType, name)} size={72} color={colors.accent} />
        <Text style={styles.fileName} numberOfLines={2}>{name}</Text>
        {!!sizeLabel && <Text style={styles.fileSize}>{sizeLabel}</Text>}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
      >
        <View style={styles.bottomRow}>
          <TextInput
            style={styles.captionInput}
            placeholder="Add a caption..."
            placeholderTextColor={colors.textMuted}
            value={caption}
            onChangeText={setCaption}
            multiline
            editable={!sending}
          />
          <TouchableOpacity
            style={styles.sendButtonRound}
            onPress={() => onSend(caption.trim())}
            disabled={sending}
          >
            {sending
              ? <ActivityIndicator size="small" color={colors.textOnAccent} />
              : <Ionicons name="send" size={18} color={colors.textOnAccent} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: Platform.OS === 'android' ? spacing.xl : 0,
    paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder,
  },
  headerBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.headerTitle, fontSize: 17, color: colors.textPrimary },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  fileName: {
    marginTop: spacing.lg, fontSize: 17, fontWeight: '700', color: colors.textPrimary,
    textAlign: 'center',
  },
  fileSize: { marginTop: spacing.xs, fontSize: 13, color: colors.textMuted },

  bottomRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  captionInput: {
    flex: 1, maxHeight: 100, minHeight: 44,
    backgroundColor: colors.surface, borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.textPrimary, marginRight: spacing.sm,
  },
  sendButtonRound: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center',
  },
});
