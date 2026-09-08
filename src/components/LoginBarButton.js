import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import { colors, spacing } from '../theme';

const BAR_W = 2172;
const BAR_H = 724;
const H_PADDING = spacing.xl * 2; // matches AuthShell's horizontal padding

// The button IS the loginbar.png artwork, used inside a TouchableOpacity
// rather than a styled View.
//
// loginbar.png has "Log In ->" baked in - that is the login button as-is
// (no `label`). Pass `label` (e.g. "Create Account") and it swaps to
// loginbar_blank.png (same art, text painted out) with the label drawn on
// top, so Sign Up keeps the exact same button style.
//
// Width/height are resolved to explicit pixels from the window size rather
// than `width:'100%' + aspectRatio` - on the New Architecture an <Image>
// sized only by aspectRatio can lay out with zero height (blank gap).
export default function LoginBarButton({
  onPress,
  label,
  loading = false,
  disabled = false,
  accessibilityLabel,
  style,
}) {
  const { width: winW } = useWindowDimensions();
  const w = Math.min(winW - H_PADDING, 440);
  const h = (w * BAR_H) / BAR_W;

  const inactive = loading || disabled;
  const source = label
    ? require('../../assets/loginbar_blank.png')
    : require('../../assets/loginbar.png');

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      accessibilityLabel={accessibilityLabel || label || 'Log in'}
      style={[styles.wrap, { width: w, height: h }, inactive && styles.inactive, style]}
    >
      <Image source={source} style={{ width: w, height: h }} resizeMode="contain" />

      {label && !loading ? (
        <View style={[styles.overlay, { width: w, height: h }]} pointerEvents="none">
          <Text style={styles.label}>{label}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={[styles.overlay, { width: w, height: h }]} pointerEvents="none">
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center' },
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: colors.textOnAccent,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  inactive: { opacity: 0.5 },
});
