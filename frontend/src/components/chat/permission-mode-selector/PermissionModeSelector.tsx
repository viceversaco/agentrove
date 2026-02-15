import { memo } from 'react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
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
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
}

export const PermissionModeSelector = memo(function PermissionModeSelector({
  dropdownPosition = 'bottom',
  disabled = false,
}: PermissionModeSelectorProps) {
  const permissionMode = useUIStore((state) => state.permissionMode);
  const setPermissionMode = useUIStore((state) => state.setPermissionMode);
  const isSplitMode = useUIStore((state) => state.isSplitMode);

  const selectedMode =
    PERMISSION_MODES.find((m) => m.value === permissionMode) || PERMISSION_MODES[2];

  return (
    <Dropdown
      value={selectedMode}
      items={PERMISSION_MODES}
      getItemKey={(mode) => mode.value}
      getItemLabel={(mode) => mode.label}
      onSelect={(mode) => setPermissionMode(mode.value)}
      width="w-48"
      itemClassName="flex flex-col gap-0.5"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      renderItem={(mode, isSelected) => (
        <>
          <span
            className={`text-xs font-medium text-text-primary ${isSelected ? 'dark:text-text-dark-primary' : 'dark:text-text-dark-secondary'}`}
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
