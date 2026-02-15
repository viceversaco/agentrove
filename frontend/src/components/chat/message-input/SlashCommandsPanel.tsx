import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import type { SlashCommand } from '@/types/ui.types';

interface SlashCommandsPanelProps {
  suggestions: SlashCommand[];
  highlightedIndex: number;
  onSelect: (command: SlashCommand) => void;
}

export const SlashCommandsPanel = memo(function SlashCommandsPanel({
  suggestions,
  highlightedIndex,
  onSelect,
}: SlashCommandsPanelProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-2">
      <div className="rounded-lg border border-border bg-surface shadow-sm dark:border-border-dark dark:bg-surface-dark">
        <div className="py-1">
          {suggestions.map((command, index) => {
            const isActive = index === highlightedIndex;
            return (
              <Button
                key={command.value}
                type="button"
                variant="unstyled"
                className={`flex w-full items-center gap-6 px-3 py-1 text-left ${
                  isActive
                    ? 'bg-surface-active dark:bg-surface-dark-active'
                    : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover'
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(command);
                }}
              >
                <span
                  className={`flex-shrink-0 font-mono text-xs leading-tight ${
                    isActive
                      ? 'text-text-primary dark:text-text-dark-primary'
                      : 'text-text-secondary dark:text-text-dark-secondary'
                  }`}
                >
                  {command.value}
                </span>
                {command.description && (
                  <span className="min-w-0 text-2xs leading-tight text-text-tertiary dark:text-text-dark-tertiary">
                    {command.description}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
