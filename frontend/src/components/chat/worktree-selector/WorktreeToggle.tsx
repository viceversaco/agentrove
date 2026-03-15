import { memo } from 'react';
import { GitFork, Check, ChevronDown } from 'lucide-react';
import { useDropdown } from '@/hooks/useDropdown';
import {
  useChatSettingsStore,
  DEFAULT_CHAT_SETTINGS_KEY,
  DEFAULT_WORKTREE,
} from '@/store/chatSettingsStore';

interface WorktreeToggleProps {
  disabled?: boolean;
}

export const WorktreeToggle = memo(function WorktreeToggle({
  disabled = false,
}: WorktreeToggleProps) {
  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[DEFAULT_CHAT_SETTINGS_KEY] ?? DEFAULT_WORKTREE,
  );
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      >
        <GitFork className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        <span>Worktree ({worktree ? 'on' : 'off'})</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-[60] mt-1 w-32 rounded-xl border border-border bg-surface-secondary/95 py-1 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95 dark:shadow-black/40">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => {
                useChatSettingsStore.getState().setWorktree(DEFAULT_CHAT_SETTINGS_KEY, value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs transition-colors duration-150 ${
                worktree === value
                  ? 'bg-surface-hover/80 text-text-primary dark:bg-surface-dark-hover/80 dark:text-text-dark-primary'
                  : 'text-text-secondary hover:bg-surface-hover/50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover/50'
              }`}
            >
              <Check
                className={`h-3 w-3 shrink-0 ${worktree === value ? 'opacity-100' : 'opacity-0'}`}
              />
              <span>{value ? 'On' : 'Off'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
