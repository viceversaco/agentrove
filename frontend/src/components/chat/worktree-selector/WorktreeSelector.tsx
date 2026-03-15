import { memo } from 'react';
import { GitFork } from 'lucide-react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
} from '@/store/chatSettingsStore';

interface WorktreeOption {
  value: boolean;
  label: string;
  description: string;
}

const WORKTREE_OPTIONS: WorktreeOption[] = [
  { value: false, label: 'Off', description: 'Use the main working directory' },
  { value: true, label: 'On', description: 'Isolate changes in a git worktree' },
];

export interface WorktreeSelectorProps {
  disabled?: boolean;
}

export const WorktreeSelector = memo(function WorktreeSelector({
  disabled = false,
}: WorktreeSelectorProps) {
  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
  );

  const selectedOption = WORKTREE_OPTIONS.find((o) => o.value === worktree) || WORKTREE_OPTIONS[0];

  return (
    <Dropdown
      value={selectedOption}
      items={WORKTREE_OPTIONS}
      getItemKey={(option) => String(option.value)}
      getItemLabel={(option) => option.label}
      onSelect={(option) =>
        useChatSettingsStore.getState().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, option.value)
      }
      leftIcon={GitFork}
      width="w-48"
      itemClassName="flex flex-col gap-0.5"
      dropdownPosition="top"
      disabled={disabled}
      compactOnMobile
      renderItem={(option, isSelected) => (
        <>
          <span
            className={`text-2xs font-medium text-text-primary ${isSelected ? 'dark:text-text-dark-primary' : 'dark:text-text-dark-secondary'}`}
          >
            {option.label}
          </span>
          <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {option.description}
          </span>
        </>
      )}
    />
  );
});
