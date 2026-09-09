// src/screens/SharedMediaScreen.js
//
// "Media, Links & Docs" - opened from the row of the same name in
// UserProfileModal. Rendered by ChatScreen as an absolute-fill overlay (the
// same pattern ContactNotificationSettings uses - no new App.js screen state).
//
// Three tabs:
//   Media - month-grouped photo grid (3 per row), tap -> ImageViewerModal,
//           long-press -> Save to Gallery / Share.
//   Links - flat list of every URL shared in the chat, tap -> Linking.openURL.
//   Docs  - static placeholder (no file-message type exists yet).
//
// Backend: GET /conversations/:id/media?type=images|links (paginated 30/page,
// private-chat 7-day window + membership enforced server-side). Base64 image
// strings are large, so each tab paginates strictly and only ever holds what
// has actually been scrolled to.
//
// The grid uses ONE FlatList whose data is a flat list of {type:'header'} and
// {type:'row', images:[<=3]} entries: this keeps month section headers AND a
// correct fixed-size getItemLayout (a real numColumns=3 grid cannot carry
// full-width headers, and getItemLayout on a SectionList has fragile
// flattened-index semantics with no supporting lib available).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Image, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Share, Linking, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radii } from '../theme';
import { getSharedMedia } from '../utils/api';
import ImageViewerModal from '../components/ImageViewerModal';

const SCREEN_W = Dimensions.get('window').width;
const CELL = SCREEN_W / 3;   // square cell edge
const HEADER_H = 34;         // month-header row height (for getItemLayout)
const PAGE = 30;

const TABS = [
  { key: 'media', label: 'Media' },
  { key: 'links', label: 'Links' },
  { key: 'docs', label: 'Docs' },
];

const EMPTY_TAB = {
  items: [], total: 0, hasMore: false, offset: 0,
  loading: false, loadingMore: false, error: null, loaded: false,
};

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? 'unknown' : `${d.getFullYear()}-${d.getMonth()}`;
}

function monthLabel(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function shortDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    const m = String(url).match(/^https?:\/\/([^/?#]+)/i);
    return m ? m[1].replace(/^www\./, '') : url;
  }
}

function EmptyState({ icon, text }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ErrorRetry({ message, onRetry }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="cloud-offline-outline" size={44} color={colors.textMuted} />
      <Text style={styles.emptyText}>{message || 'Something went wrong'}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.8}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SharedMediaScreen({
  token, conversationId, otherUser, isGroup, groupName, onBack, onSaveImage,
}) {
  const [activeTab, setActiveTab] = useState('media');
  const [media, setMedia] = useState(EMPTY_TAB);
  const [links, setLinks] = useState(EMPTY_TAB);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerUri, setViewerUri] = useState(null);
  const [savingViewer, setSavingViewer] = useState(false);

  // Mirror state into refs so onEndReached / the tab effect read fresh values
  // without re-creating callbacks on every fetch.
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const linksRef = useRef(links);
  linksRef.current = links;

  const load = useCallback(async (type, { append = false, refresh = false } = {}) => {
    const isImg = type === 'images';
    const set = isImg ? setMedia : setLinks;
    const cur = isImg ? mediaRef.current : linksRef.current;
    if (cur.loading || cur.loadingMore) return;
    if (append && !cur.hasMore) return;

    const offset = append ? cur.offset + PAGE : 0;
    set((s) => ({
      ...s,
      error: null,
      loading: append || refresh ? s.loading : true,
      loadingMore: append,
    }));
    try {
      const data = await getSharedMedia(token, conversationId, type, { limit: PAGE, offset });
      const results = Array.isArray(data.results) ? data.results : [];
      set((s) => ({
        items: append ? [...s.items, ...results] : results,
        total: data.total || 0,
        hasMore: !!data.hasMore,
        offset,
        loading: false,
        loadingMore: false,
        error: null,
        loaded: true,
      }));
    } catch (e) {
      set((s) => ({ ...s, loading: false, loadingMore: false, error: e.message || 'Could not load' }));
    }
  }, [token, conversationId]);

  // Fetch a tab the first time it is shown; cached after that (spec: do not
  // re-fetch on tab switch if data already loaded).
  useEffect(() => {
    if (activeTab === 'media' && !mediaRef.current.loaded && !mediaRef.current.loading) load('images');
    if (activeTab === 'links' && !linksRef.current.loaded && !linksRef.current.loading) load('links');
  }, [activeTab, load]);

  const onRefresh = useCallback(async () => {
    if (activeTab === 'docs') return;
    setRefreshing(true);
    try {
      await load(activeTab === 'links' ? 'links' : 'images', { refresh: true });
    } finally {
      setRefreshing(false);
    }
  }, [activeTab, load]);

  const shareImage = useCallback(async (uri) => {
    try {
      // RN core Share. For a base64 data: URI this shares the raw string -
      // fine for the http(s) GIF/sticker URLs, limited for photos (no file is
      // materialised). A future pass could write a temp file first.
      await Share.share({ message: uri });
    } catch (e) {
      /* user dismissed the sheet, or share unavailable */
    }
  }, []);

  const onLongPressImage = useCallback((uri) => {
    Alert.alert('Photo', undefined, [
      { text: 'Save to Gallery', onPress: () => onSaveImage && onSaveImage(uri) },
      { text: 'Share', onPress: () => shareImage(uri) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onSaveImage, shareImage]);

  const openUrl = useCallback((url) => {
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));
  }, []);

  // --- Media grid: flat [header | row-of-3] list -----------------------
  const gridData = useMemo(() => {
    const out = [];
    let curKey = null;
    for (const it of media.items) {
      const key = monthKey(it.created_at);
      if (key !== curKey) {
        curKey = key;
        out.push({ type: 'header', key: `h-${key}`, title: monthLabel(it.created_at) });
      }
      const last = out[out.length - 1];
      if (last && last.type === 'row' && last.images.length < 3) {
        last.images.push(it);
      } else {
        out.push({ type: 'row', key: `r-${it.id}`, images: [it] });
      }
    }
    return out;
  }, [media.items]);

  const offsets = useMemo(() => {
    const arr = [];
    let off = 0;
    for (const row of gridData) {
      const h = row.type === 'header' ? HEADER_H : CELL;
      arr.push({ length: h, offset: off });
      off += h;
    }
    return arr;
  }, [gridData]);

  const getItemLayout = useCallback((data, index) => {
    const e = offsets[index] || { length: CELL, offset: 0 };
    return { length: e.length, offset: e.offset, index };
  }, [offsets]);

  const renderMediaItem = useCallback(({ item }) => {
    if (item.type === 'header') {
      return item.title ? <Text style={styles.sectionHeader}>{item.title}</Text> : <View style={{ height: HEADER_H }} />;
    }
    return (
      <View style={styles.gridRow}>
        {item.images.map((img) => (
          <TouchableOpacity
            key={String(img.id)}
            activeOpacity={0.8}
            style={styles.cell}
            onPress={() => setViewerUri(img.content)}
            onLongPress={() => onLongPressImage(img.content)}
          >
            <Image source={{ uri: img.content }} style={styles.cellImg} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </View>
    );
  }, [onLongPressImage]);

  const renderLinkRow = useCallback(({ item }) => (
    <TouchableOpacity style={styles.linkRow} activeOpacity={0.6} onPress={() => openUrl(item.url)}>
      <Ionicons name="globe-outline" size={22} color={colors.accent} style={{ marginRight: spacing.md }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkDomain} numberOfLines={1}>{domainOf(item.url)}</Text>
        <Text style={styles.linkUrl} numberOfLines={1}>{item.url}</Text>
      </View>
      <Text style={styles.linkDate}>{shortDate(item.created_at)}</Text>
    </TouchableOpacity>
  ), [openUrl]);

  const subtitle = isGroup ? (groupName || 'Group') : (otherUser?.name || '');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>Media, Links &amp; Docs</Text>
          {!!subtitle && <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'media' && (
          media.loading && media.items.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.accent} />
          ) : media.error && media.items.length === 0 ? (
            <ErrorRetry message={media.error} onRetry={() => load('images')} />
          ) : (
            <FlatList
              data={gridData}
              keyExtractor={(item) => item.key}
              renderItem={renderMediaItem}
              getItemLayout={getItemLayout}
              removeClippedSubviews
              maxToRenderPerBatch={3}
              windowSize={5}
              initialNumToRender={4}
              onEndReached={() => load('images', { append: true })}
              onEndReachedThreshold={0.3}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
              ListFooterComponent={media.loadingMore
                ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
                : null}
              ListEmptyComponent={<EmptyState icon="image-outline" text="No photos or videos yet" />}
              contentContainerStyle={gridData.length === 0 ? styles.emptyContainer : null}
            />
          )
        )}

        {activeTab === 'links' && (
          links.loading && links.items.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 48 }} size="large" color={colors.accent} />
          ) : links.error && links.items.length === 0 ? (
            <ErrorRetry message={links.error} onRetry={() => load('links')} />
          ) : (
            <FlatList
              data={links.items}
              keyExtractor={(item, i) => `${item.id}-${i}-${item.url}`}
              renderItem={renderLinkRow}
              onEndReached={() => load('links', { append: true })}
              onEndReachedThreshold={0.3}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
              ListFooterComponent={links.loadingMore
                ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.accent} />
                : null}
              ListEmptyComponent={<EmptyState icon="link-outline" text="No links shared yet" />}
              contentContainerStyle={links.items.length === 0 ? styles.emptyContainer : null}
            />
          )
        )}

        {activeTab === 'docs' && (
          <EmptyState icon="document-outline" text="No documents yet" />
        )}
      </View>

      <ImageViewerModal
        key={viewerUri || 'none'}
        visible={!!viewerUri}
        uri={viewerUri}
        saving={savingViewer}
        onClose={() => setViewerUri(null)}
        onSave={async () => {
          if (!onSaveImage || !viewerUri) return;
          setSavingViewer(true);
          try {
            await onSaveImage(viewerUri);
          } finally {
            setSavingViewer(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: 50, paddingBottom: spacing.md,
    backgroundColor: colors.headerBackground,
    borderBottomWidth: 1, borderBottomColor: colors.headerBorder,
  },
  backBtn: { marginRight: spacing.md, padding: 2 },
  headerTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },

  tabs: {
    flexDirection: 'row', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: radii.pill, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.textOnAccent },

  sectionHeader: {
    height: HEADER_H, lineHeight: HEADER_H,
    paddingHorizontal: spacing.md,
    fontSize: 13, fontWeight: '700', color: colors.textSecondary,
    backgroundColor: colors.background,
  },

  gridRow: { flexDirection: 'row', height: CELL },
  cell: { width: CELL, height: CELL, padding: 1 },
  cellImg: { flex: 1, borderRadius: 2, backgroundColor: colors.surface },

  linkRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  linkDomain: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  linkUrl: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  linkDate: { fontSize: 11, color: colors.textMuted, marginLeft: spacing.sm },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { marginTop: spacing.md, fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  emptyContainer: { flexGrow: 1 },
  retryBtn: {
    marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm,
    backgroundColor: colors.accent, borderRadius: radii.pill,
  },
  retryText: { color: colors.textOnAccent, fontWeight: '600' },
});
