import { useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronRight, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { filesystemService } from '@/services/filesystemService';
import type { DirectoryEntry } from '@/services/filesystemService';

interface FolderBrowserProps {
  onSelect: (path: string) => void;
}

interface TreeState {
  rootPath: string;
  rootEntries: DirectoryEntry[];
  childrenByPath: Record<string, DirectoryEntry[]>;
  expandedPaths: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  selectedPath: string | null;
  parent: string | null;
}

function BreadcrumbBar({
  path,
  parent,
  onNavigate,
}: {
  path: string;
  parent: string | null;
  onNavigate: (path: string) => void;
}) {
  const segments = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    return parts.map((name, i) => ({
      name,
      path: '/' + parts.slice(0, i + 1).join('/'),
    }));
  }, [path]);

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto px-1 py-1 font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
      {parent && (
        <button
          type="button"
          onClick={() => onNavigate(parent)}
          className="shrink-0 transition-colors duration-200 hover:text-text-primary dark:hover:text-text-dark-primary"
        >
          /
        </button>
      )}
      {segments.map((seg, i) => (
        <span key={seg.path} className="flex shrink-0 items-center">
          {i > 0 && <span className="mx-0.5">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(seg.path)}
            className="transition-colors duration-200 hover:text-text-primary dark:hover:text-text-dark-primary"
          >
            {seg.name}
          </button>
        </span>
      ))}
    </div>
  );
}

function DirectoryItem({
  entry,
  level,
  state,
  onToggle,
  onSelectItem,
}: {
  entry: DirectoryEntry;
  level: number;
  state: TreeState;
  onToggle: (path: string) => void;
  onSelectItem: (path: string) => void;
}) {
  const isExpanded = !!state.expandedPaths[entry.path];
  const isLoading = !!state.loadingPaths[entry.path];
  const isSelected = state.selectedPath === entry.path;
  const children = state.childrenByPath[entry.path];

  const indentStyle = useMemo(() => ({ paddingLeft: `${level * 8 + 4}px` }), [level]);

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelectItem(entry.path)}
        onDoubleClick={() => onToggle(entry.path)}
        className={cn(
          'flex w-full items-center gap-1 rounded-md px-1.5 py-[3px] text-left',
          'transition-colors duration-150',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          isSelected &&
            'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary',
          !isSelected && 'text-text-tertiary dark:text-text-dark-tertiary',
        )}
        style={indentStyle}
      >
        {isLoading ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
        ) : (
          <ChevronRight
            onClick={(e) => {
              e.stopPropagation();
              onToggle(entry.path);
            }}
            className={cn(
              'size-3 shrink-0 cursor-pointer transition-transform duration-200',
              'text-text-quaternary dark:text-text-dark-quaternary',
              isExpanded && 'rotate-90',
            )}
          />
        )}

        {isExpanded ? (
          <FolderOpen className="size-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        ) : (
          <Folder className="size-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        )}

        <span
          className={cn('min-w-0 flex-1 truncate font-mono text-xs', isSelected && 'font-medium')}
        >
          {entry.name}
        </span>
      </button>

      {isExpanded && children && (
        <div>
          {children.map((child) => (
            <DirectoryItem
              key={child.path}
              entry={child}
              level={level + 1}
              state={state}
              onToggle={onToggle}
              onSelectItem={onSelectItem}
            />
          ))}
          {children.length === 0 && (
            <div
              className="px-1.5 py-[3px] font-mono text-2xs italic text-text-quaternary dark:text-text-dark-quaternary"
              style={{ paddingLeft: `${(level + 1) * 8 + 4}px` }}
            >
              Empty
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FolderBrowser({ onSelect }: FolderBrowserProps) {
  const [state, setState] = useState<TreeState>({
    rootPath: '',
    rootEntries: [],
    childrenByPath: {},
    expandedPaths: {},
    loadingPaths: {},
    selectedPath: null,
    parent: null,
  });
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    setInitialLoading(true);
    let cancelled = false;

    filesystemService
      .browseDirectory()
      .then((res) => {
        if (cancelled) return;
        setState({
          rootPath: res.path,
          rootEntries: res.entries,
          childrenByPath: {},
          expandedPaths: {},
          loadingPaths: {},
          selectedPath: null,
          parent: res.parent,
        });
        setInitialLoading(false);
      })
      .catch(() => {
        if (!cancelled) setInitialLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const navigateTo = useCallback((path: string) => {
    setInitialLoading(true);

    filesystemService
      .browseDirectory(path)
      .then((res) => {
        setState({
          rootPath: res.path,
          rootEntries: res.entries,
          childrenByPath: {},
          expandedPaths: {},
          loadingPaths: {},
          selectedPath: null,
          parent: res.parent,
        });
        setInitialLoading(false);
      })
      .catch(() => {
        setInitialLoading(false);
      });
  }, []);

  const toggleExpand = useCallback((path: string) => {
    setState((prev) => {
      if (prev.expandedPaths[path]) {
        const next = { ...prev, expandedPaths: { ...prev.expandedPaths } };
        delete next.expandedPaths[path];
        return next;
      }

      if (prev.childrenByPath[path]) {
        return { ...prev, expandedPaths: { ...prev.expandedPaths, [path]: true } };
      }

      // Fetch children
      const next = {
        ...prev,
        expandedPaths: { ...prev.expandedPaths, [path]: true },
        loadingPaths: { ...prev.loadingPaths, [path]: true },
      };

      filesystemService
        .browseDirectory(path)
        .then((res) => {
          setState((s) => ({
            ...s,
            childrenByPath: { ...s.childrenByPath, [path]: res.entries },
            loadingPaths: { ...s.loadingPaths, [path]: false },
          }));
        })
        .catch(() => {
          setState((s) => ({
            ...s,
            loadingPaths: { ...s.loadingPaths, [path]: false },
          }));
        });

      return next;
    });
  }, []);

  const selectItem = useCallback(
    (path: string) => {
      setState((prev) => ({ ...prev, selectedPath: path }));
      onSelect(path);
    },
    [onSelect],
  );

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-border/50 py-6 dark:border-border-dark/50">
        <Loader2 className="size-4 animate-spin text-text-quaternary dark:text-text-dark-quaternary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <BreadcrumbBar path={state.rootPath} parent={state.parent} onNavigate={navigateTo} />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border/50 p-1 dark:border-border-dark/50">
        <button
          type="button"
          onClick={() => selectItem(state.rootPath)}
          className={cn(
            'flex w-full items-center gap-1 rounded-md px-1.5 py-[3px] text-left',
            'transition-colors duration-150',
            'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
            state.selectedPath === state.rootPath &&
              'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary',
            state.selectedPath !== state.rootPath &&
              'text-text-secondary dark:text-text-dark-secondary',
          )}
        >
          <FolderOpen className="size-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          <span className="font-mono text-xs">.</span>
          <span className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            (current directory)
          </span>
        </button>
        {state.rootEntries.length === 0 ? (
          <div className="py-3 text-center font-mono text-2xs italic text-text-quaternary dark:text-text-dark-quaternary">
            No subdirectories
          </div>
        ) : (
          state.rootEntries.map((entry) => (
            <DirectoryItem
              key={entry.path}
              entry={entry}
              level={0}
              state={state}
              onToggle={toggleExpand}
              onSelectItem={selectItem}
            />
          ))
        )}
      </div>
    </div>
  );
}
