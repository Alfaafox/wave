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

  // --- New design-system tokens (additive only - see CLAUDE.md "Design
  // System"). Existing keys above are untouched: `background` and `surface`
  // are read by 60+ files across the app (including ChatScreen.js /
  // ChatListScreen.js via `...shadow.md` spreads at module-load time), so
  // repointing them would reskin/crash screens nothing here was meant to
  // touch. `screenBackground` is the dedicated off-white token for the
  // settings-style screens that opted into the new look. ---
  primary: '#2C6BED',
  primaryDark: '#1E55C4',
  primaryLight: '#EEF3FD',
  screenBackground: '#F2F3F5',
  surfaceElevated: '#FFFFFF',
  text: '#0A0A0A',
  textTertiary: '#B0B0BF',
  destructive: '#E53935',
  destructiveDark: '#C62828',
  destructiveLight: '#FFCDD2',
  success: '#2ECC71',
  toggleActive: '#2C6BED',
  toggleInactive: '#D1D1D8',
  sentBubble: '#2C6BED',
  receivedBubble: '#FFFFFF',
  sentText: '#FFFFFF',
  receivedText: '#0A0A0A',
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

  // New design-system scale (additive - see CLAUDE.md "Design System").
  title: { fontSize: 18, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyMedium: { fontSize: 15, fontWeight: '500' },
  secondary: { fontSize: 13, fontWeight: '400' },
  caption: { fontSize: 11, fontWeight: '400' },
};

// New design-system radius scale (additive - kept separate from `radii`
// above, which 30+ files already depend on with different values/keys).
// WaveButton.js and any new code should use this one.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
  card: 16,
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

// Default export (additive - nothing in the app used this before; every
// existing import is a named import, e.g. `import { colors } from '../theme'`,
// so adding this doesn't change any of those).
export default { colors, typography, spacing, radii, radius, shadow };
