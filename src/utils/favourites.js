// src/utils/favourites.js
//
// Device-local "favourites" - an array of other users' numeric ids, stored
// in AsyncStorage under 'wave_favourites'. Not synced to the account (same
// philosophy as src/utils/chatPreferences.js). Read by the favourites strip
// in ChatListScreen and the star button in UserProfileModal.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const FAVOURITES_KEY = 'wave_favourites';

export async function getFavourites() {
  try {
    const raw = await AsyncStorage.getItem(FAVOURITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function isFavourite(userId) {
  if (userId == null) return false;
  const list = await getFavourites();
  return list.includes(userId);
}

// Flips membership for userId and persists. Returns the new boolean state.
export async function toggleFavourite(userId) {
  if (userId == null) return false;
  const list = await getFavourites();
  const has = list.includes(userId);
  const next = has ? list.filter((id) => id !== userId) : [...list, userId];
  try {
    await AsyncStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
  } catch {
    /* best effort - a failed write just means it isn't remembered */
  }
  return !has;
}
