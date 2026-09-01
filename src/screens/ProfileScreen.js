import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function ProfileScreen({ currentUser, onBack, onLogout }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(currentUser?.name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.value}>{currentUser?.name}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{currentUser?.email}</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Phone number</Text>
        <Text style={styles.value}>{currentUser?.phoneNumber || 'Not set'}</Text>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50,
    backgroundColor: '#075E54'
  },
  backArrow: { color: '#fff', fontSize: 22, marginRight: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  avatarWrap: { alignItems: 'center', marginVertical: 30 },
  avatar: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#075E54',
    justifyContent: 'center', alignItems: 'center'
  },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '600' },
  field: { paddingHorizontal: 24, marginBottom: 20 },
  label: { fontSize: 13, color: '#888', marginBottom: 4 },
  value: { fontSize: 17, color: '#111' },
  logoutButton: {
    marginTop: 30, marginHorizontal: 24, backgroundColor: '#fee',
    borderRadius: 10, padding: 16, alignItems: 'center'
  },
  logoutText: { color: '#d32f2f', fontSize: 16, fontWeight: '600' }
});
