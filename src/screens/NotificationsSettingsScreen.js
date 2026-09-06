import React from 'react';
import SettingsSubScreenLayout, { ComingSoonPlaceholder } from '../components/SettingsSubScreenLayout';

export default function NotificationsSettingsScreen({ onBack }) {
  return (
    <SettingsSubScreenLayout title="Notifications" onBack={onBack}>
      <ComingSoonPlaceholder text="Ringtone/vibration for calls, message push notifications, and per-chat mute will live here." />
    </SettingsSubScreenLayout>
  );
}
