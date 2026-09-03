// src/components/MessageReactions.js
//
// Two exported components:
//   1. <ReactionPicker /> — the emoji row that appears on long-press
//   2. <ReactionPills />  — the small emoji+count badges under a message bubble
//
// Drop this file into: my-chat-app/src/components/MessageReactions.js

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// -------------------------------------------------------------
// ReactionPicker — shown as a small popup above a long-pressed message
// -------------------------------------------------------------
export function ReactionPicker({ visible, onSelect, onClose }) {
  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.pickerRow}>
          {QUICK_EMOJIS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={styles.emojiButton}
              onPress={() => {
                onSelect(emoji);
                onClose();
              }}
            >
              <Text style={styles.emojiText}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// -------------------------------------------------------------
// ReactionPills — the little badges rendered under a message bubble
// reactions shape: [{ emoji: '👍', count: 3, userIds: [12, 45] }]
// -------------------------------------------------------------
export function ReactionPills({ reactions, currentUserId, onPress, onLongPress }) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <View style={styles.pillsRow}>
      {reactions.map((r) => {
        const iReacted = r.userIds.includes(currentUserId);
        return (
          <TouchableOpacity
            key={r.emoji}
            style={[styles.pill, iReacted && styles.pillActive]}
            onPress={() => onPress(r.emoji)}
            onLongPress={() => onLongPress(r)} // e.g. show "who reacted" sheet
          >
            <Text style={styles.pillText}>
              {r.emoji} {r.count > 1 ? r.count : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  emojiButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  emojiText: {
    fontSize: 26,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    gap: 4,
  },
  pill: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillActive: {
    backgroundColor: '#dcf0ff',
    borderColor: '#4a9eff',
  },
  pillText: {
    fontSize: 13,
  },
});
