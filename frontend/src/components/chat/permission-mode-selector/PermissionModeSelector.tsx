import { memo } from 'react';
import { Shield } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import { useChatSettingsStore, DEFAULT_CHAT_SETTINGS_KEY, DEFAULT_PERMISSION_MODE } from '@/store/chatSettingsStore';
import { useUIStore } from '@/store/uiStore';

export interface PermissionModeOption {
  value: 'plan' | 'ask' | 'auto';
  label: string;
  description: string;
}

const PERMISSION_MODES: PermissionModeOption[] = [
  { value: 'plan', label: 'Plan', description: 'Review steps before running' },
  { value: 'ask', label: 'Ask', description: 'Ask permission for each action' },
  { value: 'auto', label: 'Auto', description: 'Auto-approve all actions' },
];

export interface PermissionModeSelectorProps {
  chatId?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
}

export const PermissionModeSelector = memo(function PermissionModeSelector({
  chatId,
  dropdownPosition = 'bottom',
  disabled = false,
}: PermissionModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const permissionMode = useChatSettingsStore(
    (state) => state.permissionModeByChat[key] ?? DEFAULT_PERMISSION_MODE,
  );
  const isSplitMode = useUIStore((state) => state.isSplitMode);

  const selectedMode =
    PERMISSION_MODES.find((m) => m.value === permissionMode) || PERMISSION_MODES[2];

  return (
    <Dropdown
      value={selectedMode}
      items={PERMISSION_MODES}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => useChatSettingsStore.getState().setPermissionMode(key, mode.value)}
      leftIcon={Shield}
      width="w-48"
      itemClassName="flex flex-col gap-0.5"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      renderItem={(mode, isSelected) => (
        <>
          <span
            className={`text-2xs font-medium text-text-primary ${isSelected ? 'dark:text-text-dark-primary' : 'dark:text-text-dark-secondary'}`}
          >
            {mode.label}
          </span>
          <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {mode.description}
          </span>
        </>
      )}
    />
  );
});
