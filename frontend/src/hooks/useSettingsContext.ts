import { use } from 'react';
import { SettingsContext } from '@/contexts/SettingsContextDefinition';

export function useSettingsContext() {
  const context = use(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within a SettingsProvider');
  }
  return context;
}
