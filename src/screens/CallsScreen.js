import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

export default function CallsScreen({ currentUser }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Calls</Text>
      </View>
      <View style={styles.emptyState}>
        <Ionicons name="call-outline" size={48} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No call history yet</Text>
        <Text style={styles.emptySubtitle}>Your voice and video calls will appear here.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground, borderBottomWidth: 1, borderBottomColor: colors.headerBorder
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md },
  emptySubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }
});
