import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  MessagesSquare,
  Code,
  SquareTerminal,
  KeyRound,
  Globe,
  Smartphone,
  GitCompareArrows,
  Monitor,
  Search,
  Rows2,
  Columns2,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { HighlightMatch } from '@/components/editor/file-tree/HighlightMatch';
import { cn } from '@/utils/cn';
import type { ViewType, SplitDirection } from '@/types/ui.types';

function VSCodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.15 2.587L18.21.21a1.49 1.49 0 0 0-1.705.29l-9.46 8.63l-4.12-3.128a1 1 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12L.326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a1 1 0 0 0 1.276.057l4.12-3.128l9.46 8.63a1.49 1.49 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352m-5.146 14.861L10.826 12l7.178-5.448z" />
    </svg>
  );
}

interface CommandItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hideOnMobile?: boolean;
}

const VIEW_COMMANDS: CommandItem[] = [
  { id: 'agent', label: 'Agent', icon: MessagesSquare },
  { id: 'ide', label: 'IDE', icon: VSCodeIcon, hideOnMobile: true },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'diff', label: 'Diff', icon: GitCompareArrows },
  { id: 'secrets', label: 'Secrets', icon: KeyRound },
  { id: 'webPreview', label: 'Web Preview', icon: Globe },
  { id: 'mobilePreview', label: 'Mobile Preview', icon: Smartphone },
  { id: 'browser', label: 'Browser', icon: Monitor },
];

export function CommandMenu() {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const listId = 'command-menu-list';

  const isOpen = useUIStore((state) => state.commandMenuOpen);
  const currentView = useUIStore((state) => state.currentView);
  const splitDirection = useUIStore((state) => state.splitDirection);
  const isMobile = useIsMobile();

  const visibleCommands = useMemo(
    () => VIEW_COMMANDS.filter((cmd) => !isMobile || !cmd.hideOnMobile),
    [isMobile],
  );

  const filteredCommands = useMemo(
    () => fuzzySearch(query, visibleCommands, { keys: ['label'], limit: 20 }),
    [query, visibleCommands],
  );

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [isOpen]);

  const close = useCallback(() => {
    useUIStore.getState().setCommandMenuOpen(false);
  }, []);

  const handleSelect = useCallback(
    (viewId: ViewType) => {
      const state = useUIStore.getState();
      if (viewId !== state.currentView) {
        state.handleViewClick(viewId, true);
      }
      close();
    },
    [close],
  );

  const toggleSplitDirection = useCallback(() => {
    const next: SplitDirection =
      useUIStore.getState().splitDirection === 'horizontal' ? 'vertical' : 'horizontal';
    useUIStore.getState().setSplitDirection(next);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          e.stopImmediatePropagation();
          close();
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (filteredCommands.length > 0) {
            setActiveIndex((prev) => (prev + 1) % filteredCommands.length);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (filteredCommands.length > 0) {
            setActiveIndex(
              (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length,
            );
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[activeIndex]) {
            handleSelect(filteredCommands[activeIndex].id);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, activeIndex, filteredCommands, handleSelect, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex justify-center"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command menu"
    >
      <div
        className={cn(
          'mt-20 h-fit w-full max-w-md',
          'rounded-xl border border-border/50 shadow-strong dark:border-border-dark/50',
          'bg-surface/95 backdrop-blur-xl dark:bg-surface-dark/95',
          'animate-fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search views..."
            className="h-10 w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-quaternary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              filteredCommands[activeIndex]
                ? `command-item-${filteredCommands[activeIndex].id}`
                : undefined
            }
          />
        </div>

        <div className="max-h-64 overflow-y-auto py-1" role="listbox" id={listId}>
          {filteredCommands.map((cmd, index) => {
            const Icon = cmd.icon;
            const isActive = cmd.id === currentView;

            return (
              <button
                key={cmd.id}
                id={`command-item-${cmd.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-xs transition-colors duration-200',
                  'text-text-primary dark:text-text-dark-primary',
                  index === activeIndex
                    ? 'bg-surface-active dark:bg-surface-dark-active'
                    : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(cmd.id)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                <HighlightMatch text={cmd.label} searchQuery={query} className="flex-1 text-left" />
                {isActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-text-primary dark:bg-text-dark-primary" />
                )}
              </button>
            );
          })}

          {filteredCommands.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No matching views
            </p>
          )}
        </div>

        {!isMobile && (
          <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 dark:border-border-dark/50">
            <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Enter to split · Esc to close
            </span>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleSplitDirection}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs transition-colors duration-200',
                'text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary',
                'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
              )}
              aria-label={`Split direction: ${splitDirection}`}
            >
              {splitDirection === 'horizontal' ? (
                <Columns2 className="h-3 w-3" />
              ) : (
                <Rows2 className="h-3 w-3" />
              )}
              <span className="capitalize">{splitDirection}</span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
