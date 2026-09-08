import React from 'react';
import { Image } from 'react-native';

// The full brand lockup, straight from the supplied asset (1254x1254 square,
// white ground). `height` drives the size; width matches since it's square.
export default function WaveMark({ height = 120, style }) {
  return (
    <Image
      source={require('../../assets/Wave_Chat_Gradient_Logo.png')}
      style={[{ width: height, height }, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Wave Chat"
    />
  );
}
