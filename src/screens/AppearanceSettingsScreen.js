import React from 'react';
import SettingsSubScreenLayout, { ComingSoonPlaceholder } from '../components/SettingsSubScreenLayout';

export default function AppearanceSettingsScreen({ onBack }) {
  return (
    <SettingsSubScreenLayout title="Appearance" onBack={onBack}>
      <ComingSoonPlaceholder text="Dark mode and text size will live here, once the shared theme refactor is built." />
    </SettingsSubScreenLayout>
  );
}
