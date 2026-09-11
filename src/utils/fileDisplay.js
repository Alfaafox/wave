// src/utils/fileDisplay.js
//
// Shared file-message display helpers - icon-per-type and a human-readable
// size string. Used by ChatScreen (FileBubble + FilePreviewScreen) and
// SharedMediaScreen (Docs tab) - pulled out here so a third copy of the same
// two small functions didn't get pasted in for FilePreviewScreen.

// Icon per file type - mime first, extension as a fallback (some pickers
// report a type like .doc as application/octet-stream instead of the real
// mimetype).
export function fileIconFor(mimeType, name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase() || '';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'document-text-outline';
  if (['doc', 'docx'].includes(ext)) return 'document-text-outline';
  if (['xls', 'xlsx'].includes(ext)) return 'grid-outline';
  if (['ppt', 'pptx'].includes(ext)) return 'easel-outline';
  if (ext === 'zip') return 'archive-outline';
  if (ext === 'mp3' || String(mimeType || '').startsWith('audio/')) return 'musical-notes-outline';
  if (ext === 'mp4' || String(mimeType || '').startsWith('video/')) return 'videocam-outline';
  if (ext === 'txt') return 'document-outline';
  return 'document-attach-outline';
}

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
