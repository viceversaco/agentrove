import { memo } from 'react';
import { Brain } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_THINKING_MODE,
} from '@/store/chatSettingsStore';
import { useUIStore } from '@/store/uiStore';

export interface ThinkingModeOption {
  value: string | null;
  label: string;
  tokens: string;
}

const THINKING_MODES: ThinkingModeOption[] = [
  { value: null, label: 'Off', tokens: '0' },
  { value: 'low', label: 'Low', tokens: '4k' },
  { value: 'medium', label: 'Medium', tokens: '10k' },
  { value: 'high', label: 'High', tokens: '15k' },
  { value: 'ultra', label: 'Ultra', tokens: '32k' },
];

export interface ThinkingModeSelectorProps {
  chatId?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
}

export const ThinkingModeSelector = memo(function ThinkingModeSelector({
  chatId,
  dropdownPosition = 'bottom',
  disabled = false,
}: ThinkingModeSelectorProps) {
  const key = chatId ?? DEFAULT_CHAT_SETTINGS_KEY;
  const thinkingMode = useChatSettingsStore(
    (state) => state.thinkingModeByChat[key] ?? DEFAULT_THINKING_MODE,
  );
  const isSplitMode = useUIStore((state) => state.isSplitMode);

  const selectedMode = THINKING_MODES.find((m) => m.value === thinkingMode) || THINKING_MODES[0];

  return (
    <Dropdown
      value={selectedMode}
      items={THINKING_MODES}
      getItemKey={(mode) => mode.value || 'off'}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => useChatSettingsStore.getState().setThinkingMode(key, mode.value)}
      leftIcon={Brain}
      width="w-32"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      renderItem={(mode, isSelected) => (
        <div className="flex w-full items-center justify-between gap-3">
          <span
            className={`text-2xs font-medium ${isSelected ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-secondary dark:text-text-dark-secondary'}`}
          >
            {mode.label}
          </span>
          <span className="text-2xs tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
            {mode.tokens}
          </span>
        </div>
      )}
    />
  );
});
