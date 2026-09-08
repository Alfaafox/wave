import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii } from '../theme';
import WaveMark from './WaveMark';

const TOP_INSET = (Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 48) + spacing.lg;

// Shared chrome for the auth screens: white background top to bottom,
// keyboard-aware scroll, logo pinned near the top, everything else stacked
// below it. No bottom decoration - the page ends in white. The tagline and
// wordmark are part of the logo artwork itself, not rendered as text here.
export function AuthShell({ children, markHeight = 120, topSlot = null }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {topSlot}
        <View style={styles.markWrap}>
          <WaveMark height={markHeight} />
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Log In / Sign Up switcher: pill-shaped, grey container, active tab white
// with a soft shadow.
export function AuthTabs({ active, onLogin, onSignup }) {
  return (
    <View style={styles.tabs}>
      <Pressable
        style={[styles.tab, active === 'login' && styles.tabActive]}
        onPress={active === 'login' ? undefined : onLogin}
      >
        <Text style={[styles.tabText, active === 'login' && styles.tabTextActive]}>Log In</Text>
      </Pressable>
      <Pressable
        style={[styles.tab, active === 'signup' && styles.tabActive]}
        onPress={active === 'signup' ? undefined : onSignup}
      >
        <Text style={[styles.tabText, active === 'signup' && styles.tabTextActive]}>Sign Up</Text>
      </Pressable>
    </View>
  );
}

// Labeled input. `prefix` renders a static adornment (e.g. "+91"); when
// `secureToggle` is set the field starts obscured and gets an eye button.
export function AuthField({
  label,
  prefix,
  secureToggle = false,
  style,
  containerStyle,
  ...inputProps
}) {
  const [hidden, setHidden] = useState(secureToggle);
  return (
    <View style={[styles.fieldWrap, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.inputRow}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.textMuted}
          {...inputProps}
          style={[styles.input, prefix ? styles.inputWithPrefix : null, style]}
          secureTextEntry={secureToggle ? hidden : inputProps.secureTextEntry}
        />
        {secureToggle ? (
          <Pressable
            hitSlop={10}
            onPress={() => setHidden((h) => !h)}
            style={styles.eye}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons
              name={hidden ? 'eye-outline' : 'eye-off-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function AuthLink({ children, onPress, align = 'center', style }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[{ alignSelf: alignMap[align] }, style]}>
      <Text style={styles.link}>{children}</Text>
    </Pressable>
  );
}

const alignMap = { center: 'center', left: 'flex-start', right: 'flex-end' };

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: TOP_INSET,
    paddingBottom: spacing.xxl,
  },
  markWrap: { alignItems: 'center', marginBottom: spacing.xl },

  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    padding: 4,
    marginBottom: spacing.xl,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.background,
    ...(Platform.OS === 'android'
      ? { elevation: 2 }
      : {
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
        }),
  },
  tabText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.accent },

  fieldWrap: { marginBottom: spacing.lg },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputWithPrefix: { paddingLeft: spacing.xs },
  prefix: {
    paddingLeft: spacing.lg,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  eye: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },

  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },
});
