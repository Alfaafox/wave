// src/screens/StatusCreatorScreen.js
//
// Updates / Status composer. Three modes (Text / Photo / Video) switched via
// a segmented tab at the top. Same base64 data: URI convention every other
// media type in this app uses (see processAndSendImage/Video in
// ChatScreen.js) - the created status is posted over REST via createStatus.
//
// No expo-linear-gradient - it isn't installed, and the task that asked for
// this screen was explicit: check first, fall back to solid theme colors if
// missing. So the 8 text-mode backgrounds below are solid colors, not
// gradients.
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, Alert, Animated, Platform, StatusBar,
  KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { VideoView, useVideoPlayer } from 'expo-video';
import { createStatus } from '../utils/api';
import { colors, spacing, radii, shadow } from '../theme';

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 54;

const TEXT_MAX_LEN = 500;
const TEXT_SHRINK_AFTER = 100;
const MAX_IMAGE_KB = 3000;
const MAX_VIDEO_KB = 6000;
const NOMINATIM_USER_AGENT = 'WaveChatApp/1.0 (contact: gurudayal90@gmail.com)';

// 8 solid preset backgrounds for text statuses - a WhatsApp/Instagram-style
// vivid palette, distinct from the app's own theme.js tokens (those are for
// chrome, not full-bleed story backgrounds).
const BG_COLORS = [
  '#2C6BED', '#E53E3E', '#F5A623', '#8E44AD',
  '#1F9D55', '#0EA5A5', '#1B2A4A', '#D6336C',
];

const MODES = [
  { key: 'text', label: 'Text', icon: 'text-outline' },
  { key: 'photo', label: 'Photo', icon: 'image-outline' },
  { key: 'video', label: 'Video', icon: 'videocam-outline' },
];

function approxKb(dataUri) {
  return Math.round((dataUri.length * 0.75) / 1024);
}

// Sticker pill (location / time / poll) - a small rounded white pill with a
// shadow that scale+fade-ins on mount. Each toggle mounts/unmounts its pill,
// so a fresh mount is all "toggled on" animation needs.
function StickerPill({ children, style }) {
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start();
  }, [scale]);
  return (
    <Animated.View style={[styles.stickerPill, style, { opacity: scale, transform: [{ scale }] }]}>
      {children}
    </Animated.View>
  );
}

function StatusVideoPreview({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = false;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={styles.mediaPreview}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

export default function StatusCreatorScreen({ token, onDone }) {
  const [mode, setMode] = useState('text');
  const [posting, setPosting] = useState(false);

  // Text mode
  const [text, setText] = useState('');
  const [bgColorIndex, setBgColorIndex] = useState(0);

  // Photo / Video mode
  const [photoUri, setPhotoUri] = useState(null);
  const [videoUri, setVideoUri] = useState(null);
  const [pickingMedia, setPickingMedia] = useState(false);
  const [caption, setCaption] = useState('');

  // Stickers
  const [locationOn, setLocationOn] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationData, setLocationData] = useState(null); // { address, latitude, longitude }
  const [timeOn, setTimeOn] = useState(false);
  const [pollOn, setPollOn] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  const pickMedia = useCallback(async (kind) => {
    setPickingMedia(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', `We need access to your ${kind === 'video' ? 'videos' : 'photos'} to post an update.`);
        return;
      }
      if (kind === 'photo') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.base64) { Alert.alert('Error', 'Could not read the photo.'); return; }
        const dataUri = `data:image/jpeg;base64,${asset.base64}`;
        if (approxKb(dataUri) > MAX_IMAGE_KB) {
          Alert.alert('Photo too large', `About ${approxKb(dataUri)}KB. Try a smaller photo.`);
          return;
        }
        setPhotoUri(dataUri);
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'], videoMaxDuration: 30,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset?.uri) { Alert.alert('Error', 'Could not read the video.'); return; }
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const ext = (asset.uri.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
        const mime = ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
        const dataUri = `data:${mime};base64,${base64}`;
        if (approxKb(dataUri) > MAX_VIDEO_KB) {
          Alert.alert('Video too large', `About ${approxKb(dataUri)}KB. Try a shorter clip.`);
          return;
        }
        setVideoUri(dataUri);
      }
    } catch (err) {
      Alert.alert('Error', err.message || `Could not pick a ${kind}.`);
    } finally {
      setPickingMedia(false);
    }
  }, []);

  // Auto-launch the picker the first time each mode is entered.
  useEffect(() => {
    if (mode === 'photo' && !photoUri && !pickingMedia) pickMedia('photo');
    if (mode === 'video' && !videoUri && !pickingMedia) pickMedia('video');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const toggleLocation = async () => {
    if (locationOn) { setLocationOn(false); return; }
    setLocationLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'We need location access to add your location.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
          { headers: { 'User-Agent': NOMINATIM_USER_AGENT } }
        );
        const data = await res.json();
        if (data?.display_name) address = data.display_name.split(',').slice(0, 2).join(',').trim();
      } catch (e) { /* keep the lat/lon fallback */ }
      setLocationData({ address, latitude, longitude });
      setLocationOn(true);
    } catch (err) {
      Alert.alert('Could not get your location', err.message || 'Make sure location services are on.');
    } finally {
      setLocationLoading(false);
    }
  };

  const togglePoll = () => {
    if (pollOn) { setPollOn(false); return; }
    setPollOn(true);
  };

  const handlePost = async () => {
    if (posting) return;

    let payload;
    if (mode === 'text') {
      if (!text.trim()) {
        Alert.alert('Add some text', 'Write something before posting.');
        return;
      }
      payload = { content_type: 'text', content: text.trim(), bg_color: BG_COLORS[bgColorIndex] };
    } else {
      const dataUri = mode === 'photo' ? photoUri : videoUri;
      if (!dataUri) {
        Alert.alert('Choose media', `Pick a ${mode} first.`);
        return;
      }
      payload = { content_type: mode, content: dataUri };
      if (caption.trim()) payload.caption = caption.trim();
      if (locationOn && locationData) payload.location = locationData;
      if (timeOn) payload.show_time = true;
      if (pollOn) {
        const q = pollQuestion.trim();
        const opts = pollOptions.map((o) => o.trim());
        if (!q || opts.some((o) => !o)) {
          Alert.alert('Finish the poll', 'Add a question and both options, or turn the poll off.');
          return;
        }
        payload.poll_data = { question: q, options: opts };
      }
    }

    setPosting(true);
    try {
      await createStatus(token, payload);
      onDone();
    } catch (err) {
      Alert.alert('Could not post update', err.message || 'Try again.');
    } finally {
      setPosting(false);
    }
  };

  const mediaUri = mode === 'photo' ? photoUri : videoUri;
  const fullScreenBg = mode === 'text' ? BG_COLORS[bgColorIndex] : '#000000';
  const canPost = mode === 'text' ? !!text.trim() : !!mediaUri;

  return (
    <View style={[styles.container, { backgroundColor: fullScreenBg }]}>
      <StatusBar barStyle="light-content" backgroundColor={fullScreenBg} />

      {/* Media / text canvas fills the screen behind the chrome. */}
      {mode === 'text' && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.textCanvas}
        >
          <TextInput
            style={[styles.textInput, { fontSize: text.length > TEXT_SHRINK_AFTER ? 16 : 28 }]}
            placeholder="Type a status"
            placeholderTextColor="rgba(255,255,255,0.6)"
            multiline
            maxLength={TEXT_MAX_LEN}
            value={text}
            onChangeText={setText}
            textAlign="center"
            autoFocus
          />
          <Text style={styles.charCounter}>{text.length}/{TEXT_MAX_LEN}</Text>
        </KeyboardAvoidingView>
      )}

      {mode !== 'text' && (
        <View style={styles.mediaCanvas}>
          {mediaUri ? (
            mode === 'photo' ? (
              <Image source={{ uri: mediaUri }} style={styles.mediaPreview} resizeMode="contain" />
            ) : (
              <StatusVideoPreview uri={mediaUri} />
            )
          ) : (
            <View style={styles.mediaEmpty}>
              {pickingMedia ? (
                <ActivityIndicator size="large" color="#fff" />
              ) : (
                <TouchableOpacity style={styles.mediaEmptyBtn} onPress={() => pickMedia(mode)} activeOpacity={0.8}>
                  <Ionicons name={mode === 'photo' ? 'image-outline' : 'videocam-outline'} size={40} color="#fff" />
                  <Text style={styles.mediaEmptyText}>Choose a {mode}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {mediaUri && (
            <View style={styles.stickerLayer} pointerEvents="box-none">
              {locationOn && locationData && (
                <StickerPill style={styles.stickerLocation}>
                  <Ionicons name="location" size={14} color={colors.textPrimary} />
                  <Text style={styles.stickerPillText} numberOfLines={1}>{locationData.address}</Text>
                </StickerPill>
              )}
              {timeOn && (
                <StickerPill style={locationOn ? styles.stickerTimeBelow : styles.stickerTimeAlone}>
                  <Ionicons name="time-outline" size={14} color={colors.textPrimary} />
                  <Text style={styles.stickerPillText}>
                    {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                </StickerPill>
              )}
              {pollOn && (
                <StickerPill style={styles.stickerPoll}>
                  <View style={{ width: '100%' }}>
                    <TextInput
                      style={styles.pollQuestionInput}
                      placeholder="Ask a question..."
                      placeholderTextColor={colors.textMuted}
                      value={pollQuestion}
                      onChangeText={setPollQuestion}
                      maxLength={200}
                    />
                    {[0, 1].map((idx) => (
                      <TextInput
                        key={idx}
                        style={styles.pollOptionInput}
                        placeholder={`Option ${idx + 1}`}
                        placeholderTextColor={colors.textMuted}
                        value={pollOptions[idx]}
                        onChangeText={(val) => {
                          const next = [...pollOptions];
                          next[idx] = val;
                          setPollOptions(next);
                        }}
                        maxLength={80}
                      />
                    ))}
                  </View>
                </StickerPill>
              )}
            </View>
          )}
        </View>
      )}

      {/* Top chrome: Cancel / title / Post, then the mode tabs. */}
      <View style={[styles.topBar, { top: TOP_INSET }]}>
        <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.topBarCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>New Update</Text>
        {posting ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <TouchableOpacity onPress={handlePost} disabled={!canPost} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.topBarPost, !canPost && styles.topBarPostDisabled]}>Post</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.modeTabs, { top: TOP_INSET + 44 }]}>
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeTab, active && styles.modeTabActive]}
              onPress={() => setMode(m.key)}
              activeOpacity={0.8}
            >
              <Ionicons name={m.icon} size={14} color={active ? colors.textPrimary : '#fff'} style={{ marginRight: 4 }} />
              <Text style={[styles.modeTabText, active && styles.modeTabTextActive]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Text mode: color swatch row along the bottom. */}
      {mode === 'text' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.swatchRow}
          contentContainerStyle={styles.swatchRowContent}
        >
          {BG_COLORS.map((c, idx) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, idx === bgColorIndex && styles.swatchActive]}
              onPress={() => setBgColorIndex(idx)}
              activeOpacity={0.8}
            />
          ))}
        </ScrollView>
      )}

      {/* Photo/Video mode: sticker toggle bar + caption input, bottom. */}
      {mode !== 'text' && mediaUri && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.bottomBar}
        >
          <View style={styles.stickerBar}>
            {locationLoading ? (
              <View style={styles.stickerBtn}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.stickerBtn, locationOn && styles.stickerBtnActive]}
                onPress={toggleLocation}
              >
                <Ionicons name="location-outline" size={20} color="#fff" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.stickerBtn, timeOn && styles.stickerBtnActive]}
              onPress={() => setTimeOn((v) => !v)}
            >
              <Ionicons name="time-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stickerBtn, pollOn && styles.stickerBtnActive]}
              onPress={togglePoll}
            >
              <Ionicons name="bar-chart-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.captionRow}>
            <TextInput
              style={styles.captionInput}
              placeholder="Add a caption..."
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={caption}
              onChangeText={setCaption}
              maxLength={300}
            />
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: {
    position: 'absolute', left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, height: 36,
  },
  topBarCancel: { color: '#fff', fontSize: 15, fontWeight: '500' },
  topBarTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  topBarPost: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  topBarPostDisabled: { color: 'rgba(255,255,255,0.4)' },

  modeTabs: {
    position: 'absolute', left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
  },
  modeTab: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modeTabActive: { backgroundColor: '#fff' },
  modeTabText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  modeTabTextActive: { color: colors.textPrimary },

  // --- Text mode ---
  textCanvas: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.xl },
  textInput: { color: '#fff', fontWeight: '600', textAlign: 'center', maxHeight: '70%' },
  charCounter: { position: 'absolute', bottom: 90, right: spacing.lg, color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  swatchRow: { position: 'absolute', bottom: 24, left: 0, right: 0 },
  swatchRowContent: { paddingHorizontal: spacing.lg, alignItems: 'center', gap: spacing.md },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)' },
  swatchActive: { borderColor: '#fff', width: 38, height: 38, borderRadius: 19 },

  // --- Photo/Video mode ---
  mediaCanvas: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  mediaPreview: { width: '100%', height: '100%' },
  mediaEmpty: { justifyContent: 'center', alignItems: 'center' },
  mediaEmptyBtn: { justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  mediaEmptyText: { color: '#fff', marginTop: spacing.sm, fontSize: 15, fontWeight: '500' },

  stickerLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  stickerPill: {
    position: 'absolute', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: radii.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, ...shadow.md,
  },
  stickerPillText: { marginLeft: 6, color: colors.textPrimary, fontSize: 12, fontWeight: '600', maxWidth: 200 },
  stickerLocation: { left: spacing.lg, bottom: 110 },
  stickerTimeBelow: { left: spacing.lg, bottom: 70 },
  stickerTimeAlone: { left: spacing.lg, bottom: 110 },
  stickerPoll: {
    left: spacing.lg, right: spacing.lg, top: '40%',
    flexDirection: 'column', alignItems: 'stretch', paddingVertical: spacing.md,
  },
  pollQuestionInput: {
    fontSize: 15, fontWeight: '600', color: colors.textPrimary,
    paddingVertical: 4, marginBottom: spacing.sm, textAlign: 'center',
  },
  pollOptionInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    paddingVertical: 8, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
    fontSize: 14, color: colors.textPrimary,
  },

  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: spacing.lg },
  stickerBar: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.md },
  stickerBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center', alignItems: 'center',
  },
  stickerBtnActive: { backgroundColor: colors.accent },
  captionRow: { paddingHorizontal: spacing.lg },
  captionInput: {
    backgroundColor: 'rgba(0,0,0,0.4)', color: '#fff', borderRadius: radii.pill,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontSize: 14,
  },
});
