// src/components/WaveButton.js
//
// Shared button component for the locked-in design system (CLAUDE.md ->
// "Design System"). variant: 'primary' | 'secondary' | 'destructive' |
// 'ghost' (default 'primary'). size: 'md' | 'sm' (default 'md').
//
// KNOWN RISK: Ionicons is rendered inside the Animated.View this button
// scales on press-in/out. There is a known crash on New Architecture +
// Hermes when Ionicons sits inside an Animated.View wrapper. If this crashes
// on a real device, the fallback is to drop the scale animation entirely
// (remove scaleAnim / the Animated.View) and instead vary opacity on the
// Pressable itself (pressed ? 0.7 : 1) - not yet needed here, but this is
// the documented fallback if the crash shows up.
import React, { useRef, useState } from 'react';
import { Pressable, Animated, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const SIZES = {
  md: { height: 48, paddingHorizontal: 24, fontSize: 15, fontWeight: '600', secondaryRadius: radius.md },
  sm: { height: 36, paddingHorizontal: 16, fontSize: 13, fontWeight: '600', secondaryRadius: radius.sm },
};

function variantColors(variant, disabled, pressed) {
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: pressed && !disabled ? colors.primaryLight : 'transparent',
        borderWidth: 1.5,
        borderColor: disabled ? '#A0B8F0' : colors.primary,
        labelColor: disabled ? '#A0B8F0' : colors.primary,
      };
    case 'destructive':
      return {
        backgroundColor: disabled
          ? colors.destructiveLight
          : pressed
            ? colors.destructiveDark
            : colors.destructive,
        borderWidth: 0,
        borderColor: 'transparent',
        labelColor: '#FFFFFF',
      };
    case 'ghost':
      return {
        backgroundColor: pressed && !disabled ? colors.primaryLight : 'transparent',
        borderWidth: 0,
        borderColor: 'transparent',
        labelColor: disabled ? colors.textTertiary : colors.primary,
      };
    case 'primary':
    default:
      return {
        backgroundColor: disabled ? '#A0B8F0' : pressed ? colors.primaryDark : colors.primary,
        borderWidth: 0,
        borderColor: 'transparent',
        labelColor: '#FFFFFF',
      };
  }
}

export default function WaveButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    setPressed(true);
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    setPressed(false);
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }).start();
  };

  const sizeSpec = SIZES[size] || SIZES.md;
  const v = variantColors(variant, isDisabled, pressed);
  const isPill = variant === 'primary' || variant === 'destructive';
  const borderRadius = isPill ? radius.pill : sizeSpec.secondaryRadius;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      style={{ alignSelf: fullWidth ? 'stretch' : 'flex-start' }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            height: sizeSpec.height,
            paddingHorizontal: sizeSpec.paddingHorizontal,
            borderRadius,
            backgroundColor: v.backgroundColor,
            borderWidth: v.borderWidth,
            borderColor: v.borderColor,
          },
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {!!icon && !loading && (
          <Ionicons name={icon} size={18} color={v.labelColor} style={{ marginRight: 8 }} />
        )}
        {loading ? (
          <ActivityIndicator color={v.labelColor} />
        ) : (
          <Text style={{ color: v.labelColor, fontSize: sizeSpec.fontSize, fontWeight: sizeSpec.fontWeight }}>
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}
