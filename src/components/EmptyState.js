// src/components/EmptyState.js
//
// Shared empty-state block: icon + title + body, used whenever a screen has
// no content to show (empty conversation list, no calls yet, etc). Icons are
// drawn inline with react-native-svg (already a dependency) rather than
// Ionicons, since the spec calls for a distinct minimal Feather-style set.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Polygon, Line } from 'react-native-svg';
import { colors } from '../theme';

const ICON_COLOR = '#9E9E9E';
const STROKE_PROPS = {
  stroke: ICON_COLOR,
  strokeWidth: 1.5,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function ChatIcon() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Path {...STROKE_PROPS} d="M8 16a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H20l-8 7v-7h-0a4 4 0 0 1-4-4V16z" />
      <Path {...STROKE_PROPS} d="M28 30v4a4 4 0 0 0 4 4h12l6 5v-5h0a4 4 0 0 0 4-4V22a4 4 0 0 0-4-4H40" />
    </Svg>
  );
}

function PhoneIcon() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Path
        {...STROKE_PROPS}
        d="M20 10h-4a4 4 0 0 0-4 4c0 17.7 14.3 32 32 32a4 4 0 0 0 4-4v-4c0-1.6-1.1-3-2.7-3.4l-8-2a3.4 3.4 0 0 0-3.5 1l-2.8 2.8a26 26 0 0 1-11.4-11.4l2.8-2.8c.9-.9 1.3-2.3 1-3.5l-2-8A3.5 3.5 0 0 0 20 10z"
      />
    </Svg>
  );
}

function StatusIcon() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Circle {...STROKE_PROPS} cx="32" cy="32" r="22" />
      <Polygon {...STROKE_PROPS} points="27,23 42,32 27,41" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Circle {...STROKE_PROPS} cx="28" cy="28" r="14" />
      <Line {...STROKE_PROPS} x1="38.5" y1="38.5" x2="50" y2="50" />
    </Svg>
  );
}

function ClockIcon() {
  return (
    <Svg width={64} height={64} viewBox="0 0 64 64">
      <Circle {...STROKE_PROPS} cx="32" cy="32" r="22" />
      <Line {...STROKE_PROPS} x1="32" y1="32" x2="32" y2="20" />
      <Line {...STROKE_PROPS} x1="32" y1="32" x2="40" y2="38" />
    </Svg>
  );
}

const ICONS = {
  chat: ChatIcon,
  phone: PhoneIcon,
  status: StatusIcon,
  search: SearchIcon,
  clock: ClockIcon,
};

export default function EmptyState({ icon, title, body }) {
  const IconComponent = ICONS[icon] || ChatIcon;
  return (
    <View style={styles.container}>
      <IconComponent />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
});
