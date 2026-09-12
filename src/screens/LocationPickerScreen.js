// src/screens/LocationPickerScreen.js
//
// WhatsApp/Telegram-style location picker: full-screen map, a FIXED pin at
// screen center (the map pans under it - never a draggable Marker), a
// debounced reverse-geocoded address, "Send your current location", and
// "Share live location" (duration picker -> LiveLocationSheet). Rendered by
// ChatScreen as a conditional full-screen overlay (the same plain-View
// pattern as SharedMediaScreen / FilePreviewScreen), not an RN Modal.
//
// Mapping: @maplibre/maplibre-react-native, not react-native-maps.
// react-native-maps was rejected - it hard-requires a Google Maps API key
// registered in AndroidManifest.xml to render at all on Android, even
// showing nothing but custom (e.g. OSM) tiles via UrlTile - a well-documented
// library limitation (github.com/maplibre/maplibre-react-native predecessor
// issues #5156, #2486, #773), not something avoidable by tile-source choice.
// MapLibre has no such dependency; the `mapStyle` below is a minimal inline
// raster style pointing at the standard OSM tile server, no key of any kind.
//
// Reverse geocoding: OpenStreetMap Nominatim (free, no key). Its usage
// policy caps at ~1 request/second and requires a real identifying
// User-Agent - the debounce below keeps this under that even during a fast
// pan, but neither Nominatim nor tile.openstreetmap.org is meant for heavy
// production traffic; a paid provider or self-hosted tiles/geocoder is the
// right move past hobby-project scale (same caveat this app already
// accepted when it chose "no external map APIs" for the original one-shot
// location share).
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  SafeAreaView, View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Map, Camera, UserLocation } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { colors, spacing, radii, typography, shadow } from '../theme';
import LiveLocationSheet from '../components/LiveLocationSheet';

const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '\u00A9 OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const DEFAULT_ZOOM = 16;
const GEOCODE_DEBOUNCE_MS = 700;
const NOMINATIM_USER_AGENT = 'WaveChatApp/1.0 (contact: gurudayal90@gmail.com)';

function fallbackAddress(coords) {
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

export default function LocationPickerScreen({ onSendStatic, onStartLive, onCancel }) {
  const [region, setRegion] = useState(null); // { latitude, longitude }
  const [address, setAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [showDurationSheet, setShowDurationSheet] = useState(false);
  const [loading, setLoading] = useState(true);

  const cameraRef = useRef(null);
  const geocodeTimer = useRef(null);
  const geocodeReqId = useRef(0);

  const reverseGeocode = useCallback(async (coords) => {
    const reqId = ++geocodeReqId.current;
    setAddressLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json`,
        { headers: { 'User-Agent': NOMINATIM_USER_AGENT } }
      );
      const data = await res.json();
      if (reqId !== geocodeReqId.current) return; // a newer pan superseded this
      setAddress((data && data.display_name) || fallbackAddress(coords));
    } catch (e) {
      if (reqId !== geocodeReqId.current) return;
      setAddress(fallbackAddress(coords));
    } finally {
      if (reqId === geocodeReqId.current) setAddressLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'We need location access to share your location.');
          onCancel();
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setRegion(coords);
        setLoading(false);
        reverseGeocode(coords);
      } catch (err) {
        Alert.alert('Could not get your location', err.message || 'Make sure location services are on.');
        onCancel();
      }
    })();
    return () => clearTimeout(geocodeTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fixed-center-pin pattern: the pin never moves - the map moves under it.
  // "Where is the pin pointing" is always the current camera center, which
  // this event hands us directly, so there's no need to imperatively call
  // map.getCenter(). `userInteraction` (MapLibre's equivalent of
  // react-native-maps' `isGesture`) guards against the initial programmatic
  // Camera placement (mount, and the recenter button) re-triggering a
  // geocode of a spot whose address we may already have.
  const handleRegionDidChange = (event) => {
    const { center, userInteraction } = event.nativeEvent || {};
    if (!userInteraction || !center) return;
    const coords = { longitude: center[0], latitude: center[1] };
    setRegion(coords);
    clearTimeout(geocodeTimer.current);
    setAddressLoading(true);
    geocodeTimer.current = setTimeout(() => reverseGeocode(coords), GEOCODE_DEBOUNCE_MS);
  };

  const recenter = async () => {
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      cameraRef.current?.easeTo({ center: [coords.longitude, coords.latitude], zoom: DEFAULT_ZOOM, duration: 400 });
      setRegion(coords);
      reverseGeocode(coords);
    } catch (err) {
      Alert.alert('Could not get your location', err.message || 'Try again.');
    }
  };

  const handleSendStatic = () => {
    if (!region) return;
    onSendStatic({ latitude: region.latitude, longitude: region.longitude, address });
  };

  const handlePickDuration = (durationMs) => {
    setShowDurationSheet(false);
    if (!region) return;
    onStartLive({ latitude: region.latitude, longitude: region.longitude, durationMs });
  };

  if (loading || !region) {
    return (
      <SafeAreaView style={[styles.container, styles.centerFill]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Map
        style={styles.map}
        mapStyle={OSM_STYLE}
        onRegionDidChange={handleRegionDidChange}
        compass={false}
        logo={false}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [region.longitude, region.latitude], zoom: DEFAULT_ZOOM }}
        />
        <UserLocation animated accuracy={false} heading={false} />
      </Map>

      {/* Fixed center pin - pointerEvents="none" so it never intercepts the
          map's own pan/pinch gestures. Offsetting by half the icon's height
          points its visual center (not its top) at the exact screen center. */}
      <View style={styles.pinWrap} pointerEvents="none">
        <Ionicons name="location" size={40} color={colors.accent} />
      </View>

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.topBarBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Share Location</Text>
        <View style={styles.topBarBtn} />
      </View>

      <TouchableOpacity style={styles.recenterBtn} onPress={recenter} activeOpacity={0.8}>
        <Ionicons name="locate" size={22} color={colors.accent} />
      </TouchableOpacity>

      <View style={styles.bottomCard}>
        <View style={styles.addressRow}>
          <Ionicons name="location-sharp" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
          <Text style={[styles.addressText, addressLoading && styles.addressTextLoading]} numberOfLines={1}>
            {addressLoading ? 'Finding address...' : (address || 'Unknown location')}
          </Text>
        </View>

        <TouchableOpacity style={styles.optionRow} onPress={handleSendStatic} activeOpacity={0.7}>
          <Ionicons name="paper-plane-outline" size={22} color={colors.accent} style={styles.optionIcon} />
          <Text style={styles.optionText}>Send your current location</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.optionDivider} />

        <TouchableOpacity style={styles.optionRow} onPress={() => setShowDurationSheet(true)} activeOpacity={0.7}>
          <Ionicons name="navigate-outline" size={22} color={colors.accent} style={styles.optionIcon} />
          <Text style={styles.optionText}>Share live location</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <LiveLocationSheet
        visible={showDurationSheet}
        onPick={handlePickDuration}
        onClose={() => setShowDurationSheet(false)}
      />
    </SafeAreaView>
  );
}

const PIN_SIZE = 40;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centerFill: { alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },

  pinWrap: {
    position: 'absolute', top: '50%', left: '50%',
    marginLeft: -PIN_SIZE / 2, marginTop: -PIN_SIZE / 2,
  },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  topBarBtn: { width: 40, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { ...typography.headerTitle, fontSize: 17, color: colors.textPrimary },

  recenterBtn: {
    position: 'absolute', right: spacing.lg, bottom: 190,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center',
    ...shadow.md,
  },

  bottomCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg,
    paddingTop: spacing.lg, paddingBottom: spacing.xl,
    ...shadow.md,
  },
  addressRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
  },
  addressText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  addressTextLoading: { color: colors.textMuted },

  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.xl,
  },
  optionIcon: { marginRight: spacing.lg },
  optionText: { flex: 1, fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
  optionDivider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.xl },
});
