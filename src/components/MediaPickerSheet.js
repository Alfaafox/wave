// src/components/MediaPickerSheet.js
//
// WhatsApp/Telegram-style bottom sheet with three tabs: Emoji, GIF, Sticker.
// Opens at the same height as the system keyboard (see useKeyboardHeight.js)
// so switching between "typing" and "picking" doesn't cause a visual jump.
//
// IMPORTANT - things that still need real-device verification, listed
// honestly rather than glossed over:
//   1. The exact keyboard height is measured live per-device (see the hook's
//      own comments) - it will differ across your S25 / Redmi / S10+, and
//      the very first time this opens in a fresh app session (before the
//      system keyboard has shown even once), it uses a 300px fallback. Open
//      the text input at least once per test session before judging the
//      sheet's height as "wrong".
//   2. This has been validated for JS/JSX syntax correctness only. It has
//      NOT been run on an emulator or physical device - I have neither
//      available in my environment. Please run your normal multi-device
//      pass before considering this final, same as you already do for
//      calling.
//
// New dependencies required (see chat message for install commands):
//   - rn-emoji-keyboard      (emoji tab - pure JS, no native code)
//   - react-native-keyboard-controller (keyboard height tracking + smooth
//     transition - officially listed in Expo SDK 57 docs)
//   - react-native-reanimated (peer dependency of the smooth transition)

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated, PanResponder, Dimensions,
} from 'react-native';
import { EmojiKeyboard } from 'rn-emoji-keyboard';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii } from '../theme';
import { useKeyboardHeight } from '../utils/useKeyboardHeight';

const TABS = {
  EMOJI: 'emoji',
  GIF: 'gif',
  STICKER: 'sticker',
};

const GRID_COLUMNS = 3;
const SEARCH_DEBOUNCE_MS = 400;

// Drag-to-expand sheet: two height states only. Collapsed matches the
// keyboard height (see useKeyboardHeight.js); expanded gives more room to
// browse GIFs/stickers. screenHeight is read once at module load - fine
// since it's only used for a fixed proportion, not live orientation tracking.
const screenHeight = Dimensions.get('window').height;
const EXPANDED_HEIGHT = Math.round(screenHeight * 0.72);
const DRAG_SNAP_THRESHOLD = 30;
const DRAG_TAP_THRESHOLD = 10;

// GIPHY's API Terms of Service require a visible "Powered By GIPHY"
// attribution wherever GIPHY content is shown. MediaGrid is rendered ONLY
// for the GIF and Sticker tabs (the Emoji tab uses EmojiKeyboard), so
// placing this inside MediaGrid - and outside the loading/error/results
// switch - guarantees it is on screen the whole time either of those tabs
// is active, in every state. Kept as plain text because there is no bundled
// GIPHY logo asset and the task forbids new dependencies.
function GiphyAttribution() {
  return (
    <View style={styles.giphyAttribution}>
      <Text style={styles.giphyAttributionText}>Powered by GIPHY</Text>
    </View>
  );
}

function MediaGrid({ endpoint, token, serverUrl, onPick }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const runSearch = useCallback((text) => {
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const q = encodeURIComponent(text.trim() || 'trending');
    fetch(`${serverUrl}/media/${endpoint}/search?q=${q}&limit=30`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        // Ignore stale responses if the user kept typing after this request
        // was sent (classic race condition otherwise - same class of bug as
        // the ICE-candidate race in the calling saga, different feature).
        if (thisRequestId !== requestIdRef.current) return;
        if (data.ok) {
          setResults(data.results || []);
        } else {
          setError(data.error || 'Search failed');
        }
      })
      .catch(() => {
        if (thisRequestId === requestIdRef.current) {
          setError('Could not reach the server');
        }
      })
      .finally(() => {
        if (thisRequestId === requestIdRef.current) setLoading(false);
      });
  }, [endpoint, token, serverUrl]);

  const handleChangeText = (text) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text), SEARCH_DEBOUNCE_MS);
  };

  // Load trending content once when this tab first mounts.
  useEffect(() => {
    runSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} style={{ marginRight: spacing.xs }} />
        <TextInput
          style={styles.searchInput}
          placeholder={endpoint === 'gifs' ? 'Search GIFs' : 'Search stickers'}
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={handleChangeText}
        />
      </View>

      <View style={styles.gridBody}>
      {loading && results.length === 0 ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={{ padding: spacing.sm }}
          ListEmptyComponent={<Text style={styles.emptyText}>No results</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.gridItem}
              onPress={() => onPick(item.fullUrl)}
              activeOpacity={0.7}
            >
              <Image source={{ uri: item.previewUrl }} style={styles.gridImage} resizeMode="cover" />
            </TouchableOpacity>
          )}
        />
      )}
      </View>

      <GiphyAttribution />
    </View>
  );
}

export default function MediaPickerSheet({ visible, token, serverUrl, onInsertEmoji, onPickMedia, onRequestClose }) {
  const [activeTab, setActiveTab] = useState(TABS.EMOJI);
  const { keyboardHeight } = useKeyboardHeight();

  // Two height states only: collapsed (== keyboardHeight) or expanded (a
  // fixed proportion of the screen). sheetHeight is the Animated.Value that
  // actually drives the View's height - `expanded` is just which snap point
  // we're tracking so the tap-toggle and keyboard-height-change effect know
  // which way to go.
  const [expanded, setExpanded] = useState(false);
  const sheetHeight = useRef(new Animated.Value(keyboardHeight)).current;

  const snapTo = useCallback((toExpanded) => {
    setExpanded(toExpanded);
    Animated.spring(sheetHeight, {
      toValue: toExpanded ? EXPANDED_HEIGHT : keyboardHeight,
      useNativeDriver: false,
      friction: 9,
      tension: 50,
    }).start();
  }, [sheetHeight, keyboardHeight]);

  // PanResponder handlers must always see the latest `snapTo`/`expanded`
  // (keyboardHeight can change between drags), but PanResponder.create is
  // only called once - so route through a ref that's refreshed every render
  // instead of recreating the responder (which would risk dropping an
  // in-flight gesture).
  const latestRef = useRef({ snapTo, expanded });
  latestRef.current = { snapTo, expanded };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_evt, gestureState) => {
        const { dy } = gestureState;
        if (dy < -DRAG_SNAP_THRESHOLD) {
          latestRef.current.snapTo(true);
        } else if (dy > DRAG_SNAP_THRESHOLD) {
          latestRef.current.snapTo(false);
        } else if (Math.abs(dy) < DRAG_TAP_THRESHOLD) {
          latestRef.current.snapTo(!latestRef.current.expanded);
        }
      },
    })
  ).current;

  // Keyboard height can change (different device measurement settling in,
  // third-party keyboard swap, etc.) - while collapsed, track it live so the
  // sheet still matches the keyboard exactly. Not animated - this mirrors
  // the keyboard's own live height, a spring here would lag behind it.
  useEffect(() => {
    if (!expanded) {
      sheetHeight.setValue(keyboardHeight);
    }
  }, [keyboardHeight, expanded, sheetHeight]);

  // Always reopen collapsed next time, regardless of how it was left.
  useEffect(() => {
    if (!visible) {
      setExpanded(false);
      sheetHeight.setValue(keyboardHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
      <View style={styles.dragHandleContainer} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === TABS.EMOJI && styles.tabBtnActive]}
          onPress={() => setActiveTab(TABS.EMOJI)}
        >
          <Ionicons name="happy-outline" size={20} color={activeTab === TABS.EMOJI ? colors.accent : colors.textMuted} />
          <Text style={[styles.tabLabel, activeTab === TABS.EMOJI && styles.tabLabelActive]}>Emoji</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === TABS.GIF && styles.tabBtnActive]}
          onPress={() => setActiveTab(TABS.GIF)}
        >
          <Ionicons name="film-outline" size={20} color={activeTab === TABS.GIF ? colors.accent : colors.textMuted} />
          <Text style={[styles.tabLabel, activeTab === TABS.GIF && styles.tabLabelActive]}>GIF</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === TABS.STICKER && styles.tabBtnActive]}
          onPress={() => setActiveTab(TABS.STICKER)}
        >
          <Ionicons name="pricetag-outline" size={20} color={activeTab === TABS.STICKER ? colors.accent : colors.textMuted} />
          <Text style={[styles.tabLabel, activeTab === TABS.STICKER && styles.tabLabelActive]}>Sticker</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.keyboardToggleBtn} onPress={onRequestClose}>
          <Ionicons name="keypad-outline" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === TABS.EMOJI && (
          // NOTE: onEmojiSelected and enableRecentlyUsed are confirmed real
          // props from the library's docs. I have NOT verified the exact
          // theming/styling prop names (things like custom colors, search
          // bar toggle, category tab position) against the actual shipped
          // TypeScript types - rather than guess and risk a prop silently
          // doing nothing, check node_modules/rn-emoji-keyboard's .d.ts
          // files (or just let VS Code's autocomplete show you `<EmojiKeyboard
          // />`'s full prop list) once it's installed, and theme it to match
          // colors.js from there. Functionally it will work as-is; it just
          // won't match your app's exact color palette until that pass.
          <EmojiKeyboard
            onEmojiSelected={(emojiObject) => onInsertEmoji(emojiObject.emoji)}
            enableRecentlyUsed
          />
        )}
        {activeTab === TABS.GIF && (
          <MediaGrid
            endpoint="gifs"
            token={token}
            serverUrl={serverUrl}
            onPick={(url) => onPickMedia(url, 'gif')}
          />
        )}
        {activeTab === TABS.STICKER && (
          <MediaGrid
            endpoint="stickers"
            token={token}
            serverUrl={serverUrl}
            onPick={(url) => onPickMedia(url, 'sticker')}
          />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  dragHandleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tabLabel: { fontSize: 12, color: colors.textMuted },
  tabLabelActive: { color: colors.accent, fontWeight: '600' },
  keyboardToggleBtn: { padding: spacing.sm },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },

  gridBody: { flex: 1 },

  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.textMuted, fontSize: 13 },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: 30 },

  // "Powered by GIPHY" attribution bar - required by the GIPHY API terms
  // whenever GIF/Sticker (GIPHY-sourced) content is on screen.
  giphyAttribution: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  giphyAttributionText: {
    fontSize: 11,
    letterSpacing: 0.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },

  gridItem: {
    flex: 1 / GRID_COLUMNS,
    aspectRatio: 1,
    padding: 4,
  },
  gridImage: {
    flex: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
});
