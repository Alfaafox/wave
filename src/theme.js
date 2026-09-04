// src/theme.js
// Shared design tokens — Signal-inspired. Import this everywhere instead of hardcoding hex values.

export const colors = {
  // Core
  background: '#FFFFFF',
  surface: '#F6F6F6',
  border: '#E8E8E8',

  // Text
  textPrimary: '#0B0B0B',
  textSecondary: '#6B6B6B',
  textMuted: '#9A9A9A',
  textOnAccent: '#FFFFFF',

  // Accent (Signal blue)
  accent: '#2C6BED',
  accentPressed: '#2557C7',

  // Bubbles
  bubbleOutgoing: '#2C6BED',
  bubbleOutgoingText: '#FFFFFF',
  bubbleIncoming: '#F0F0F0',
  bubbleIncomingText: '#0B0B0B',

  // Status
  online: '#2ECC71',
  danger: '#E53E3E',
  warning: '#F5A623',

  // Misc
  unreadBadge: '#2C6BED',
  headerBackground: '#FFFFFF',
  headerBorder: '#EAEAEA',
  divider: '#EDEDED',
  overlay: 'rgba(0,0,0,0.4)',
  recordingPulse: '#E53E3E',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
  bubble: 18,
  bubbleTail: 4, // corner nearest the sender's tail
};

export const typography = {
  headerTitle: { fontSize: 20, fontWeight: '700' },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowPreview: { fontSize: 14, fontWeight: '400' },
  timestamp: { fontSize: 12, fontWeight: '400' },
  bubbleText: { fontSize: 15, fontWeight: '400' },
};

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
};
