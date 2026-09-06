// Device-local (AsyncStorage) chat preferences - not synced to the account
// server. Shared between ChatsSettingsScreen.js (where they're set) and
// ChatScreen.js (where they're read/applied).

export const WALLPAPER_STORAGE_KEY = 'wave:chatWallpaper';
export const AUTOSAVE_STORAGE_KEY = 'wave:autoSaveMedia';

export const WALLPAPER_OPTIONS = [
  { id: 'default', label: 'Default', color: null },
  { id: 'soft-blue', label: 'Soft Blue', color: '#EAF1FC' },
  { id: 'mint', label: 'Mint', color: '#E6F7F0' },
  { id: 'warm-sand', label: 'Warm Sand', color: '#FBF3E7' },
  { id: 'lavender', label: 'Lavender', color: '#F1EDFB' },
  { id: 'charcoal', label: 'Charcoal', color: '#EDEDED' },
];

export function getWallpaperColor(wallpaperId) {
  const match = WALLPAPER_OPTIONS.find((w) => w.id === wallpaperId);
  return match?.color || null;
}
