import { createContext } from 'react';
import type { UserSettings } from '@/types/user.types';

export type PersistSettingsFn = (
  updater: (previous: UserSettings) => UserSettings,
  options?: { successMessage?: string; errorMessage?: string },
) => Promise<void>;

export interface SettingsContextValue {
  localSettings: UserSettings;
  setLocalSettings: React.Dispatch<React.SetStateAction<UserSettings>>;
  persistSettings: PersistSettingsFn;
  settings: UserSettings | undefined;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);
