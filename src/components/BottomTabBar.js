import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

const TABS = [
  { key: 'chatList', label: 'Chats', icon: 'chatbubbles', iconOutline: 'chatbubbles-outline' },
  { key: 'calls', label: 'Calls', icon: 'call', iconOutline: 'call-outline' },
  { key: 'updates', label: 'Updates', icon: 'radio-button-on', iconOutline: 'radio-button-off-outline' }
];

export default function BottomTabBar({ activeTab, onTabPress }) {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabPress(tab.key)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isActive ? tab.icon : tab.iconOutline}
              size={24}
              color={isActive ? colors.accent : colors.textMuted}
            />
            <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '500'
  },
  labelActive: {
    color: colors.accent,
    fontWeight: '600'
  }
});
