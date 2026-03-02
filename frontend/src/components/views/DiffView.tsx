import { memo, useMemo, useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  FileText,
  GitCompareArrows,
  Rows2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useGitDiffQuery } from '@/hooks/queries/useSandboxQueries';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type { DiffMode } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';

const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

const DIFF_MODES: DiffMode[] = ['all', 'staged', 'unstaged', 'branch'];
const DIFF_MODE_LABELS: Record<DiffMode, string> = {
  all: 'Uncommitted',
  staged: 'Staged',
  unstaged: 'Unstaged',
  branch: 'Branch',
};

const DIFF_EMPTY_LABELS: Record<DiffMode, string> = {
  all: 'No uncommitted changes',
  staged: 'No staged changes',
  unstaged: 'No unstaged changes',
  branch: 'No changes from base branch',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  deleted: 'Deleted',
  'rename-pure': 'Renamed',
  'rename-changed': 'Renamed',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-success-600/15 text-success-600 dark:bg-success-400/15 dark:text-success-400',
  deleted: 'bg-error-600/15 text-error-600 dark:bg-error-400/15 dark:text-error-400',
  'rename-pure': 'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
  'rename-changed':
    'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
};

interface FileDiffMeta {
  name: string;
  prevName?: string;
  type?: string;
  hunks?: { additionCount: number; deletionCount: number }[];
  [key: string]: unknown;
}

type FileDiffComponent = React.ComponentType<{
  fileDiff: FileDiffMeta;
  options?: Record<string, unknown>;
}>;

function FileDiffRenderer({
  file,
  options,
}: {
  file: FileDiffMeta;
  options: Record<string, unknown>;
}) {
  const [FileDiff, setFileDiff] = useState<FileDiffComponent | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('@pierre/diffs/react');
      if (!cancelled) setFileDiff(() => mod.FileDiff as FileDiffComponent);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!FileDiff) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
      </div>
    );
  }

  return (
    <ErrorBoundary
      fallback={
        <div className="px-3 py-4 text-xs text-error-600 dark:text-error-400">
          Failed to render diff for this file
        </div>
      }
    >
      <FileDiff fileDiff={file} options={options} />
    </ErrorBoundary>
  );
}

function FileStats({ file }: { file: FileDiffMeta }) {
  const hunks = file.hunks;
  if (!hunks || hunks.length === 0) return null;

  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    additions += h.additionCount;
    deletions += h.deletionCount;
  }

  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-2xs">
      {additions > 0 && (
        <span className="text-success-600 dark:text-success-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-error-600 dark:text-error-400">&minus;{deletions}</span>
      )}
    </span>
  );
}

function FileStatusBadge({ type }: { type?: string }) {
  if (!type || type === 'change') return null;
  const label = STATUS_LABELS[type];
  const colors = STATUS_COLORS[type];
  if (!label || !colors) return null;

  return (
    <span
      className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none', colors)}
    >
      {label}
    </span>
  );
}

interface DiffViewProps {
  sandboxId?: string;
}

export const DiffView = memo(function DiffView({ sandboxId }: DiffViewProps) {
  const theme = useResolvedTheme();
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set());
  const [parsedFiles, setParsedFiles] = useState<FileDiffMeta[]>([]);
  const [parsingDone, setParsingDone] = useState(false);
  const [mode, setMode] = useState<DiffMode>('all');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');

  const {
    data: diffData,
    isFetching,
    isError,
    refetch,
  } = useGitDiffQuery(sandboxId || '', mode, { enabled: !!sandboxId });

  const diffContent = diffData?.diff ?? '';

  useEffect(() => {
    setParsedFiles([]);
    setParsingDone(false);
    setExpandedFiles(new Set());
    if (!diffContent) {
      setParsingDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { parsePatchFiles } = await import('@pierre/diffs');
        const patches = parsePatchFiles(diffContent);
        if (!cancelled) {
          setParsedFiles(patches.flatMap((p) => p.files));
        }
      } finally {
        if (!cancelled) setParsingDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diffContent]);

  const options = useMemo(
    () => ({
      theme: DIFF_THEMES,
      themeType: theme,
      diffStyle,
      disableFileHeader: true,
    }),
    [theme, diffStyle],
  );

  const toggleFile = useCallback((index: number) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const allExpanded = parsedFiles.length > 0 && expandedFiles.size === parsedFiles.length;

  const toggleAll = useCallback(() => {
    setExpandedFiles((prev) => {
      if (prev.size === parsedFiles.length && parsedFiles.length > 0) {
        return new Set();
      }
      return new Set(parsedFiles.map((_, i) => i));
    });
  }, [parsedFiles]);

  if (!sandboxId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary text-xs text-text-quaternary dark:bg-surface-dark-secondary dark:text-text-dark-quaternary">
        No sandbox connected
      </div>
    );
  }

  const isLoading = isFetching && !diffData;
  const isGitRepo = diffData?.is_git_repo ?? false;
  const hasChanges = diffData?.has_changes ?? false;
  const diffError = diffData?.error ?? null;
  const showFiles = !isLoading && !isError && isGitRepo && hasChanges && parsedFiles.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex h-9 items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
        <Button
          onClick={() => refetch()}
          variant="unstyled"
          className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          title="Refresh diff"
          aria-label="Refresh diff"
        >
          <RotateCcw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </Button>

        <Dropdown
          value={mode}
          items={DIFF_MODES}
          getItemKey={(m) => m}
          getItemLabel={(m) => DIFF_MODE_LABELS[m]}
          onSelect={setMode}
          width="w-32"
        />

        <div className="flex-1" />

        {showFiles && (
          <>
            <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {parsedFiles.length} file{parsedFiles.length !== 1 ? 's' : ''}
            </span>
            <Button
              onClick={toggleAll}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              title={allExpanded ? 'Collapse all' : 'Expand all'}
              aria-label={allExpanded ? 'Collapse all' : 'Expand all'}
            >
              {allExpanded ? (
                <ChevronsDownUp className="h-3 w-3" />
              ) : (
                <ChevronsUpDown className="h-3 w-3" />
              )}
            </Button>
          </>
        )}

        <Button
          onClick={() => setDiffStyle(diffStyle === 'unified' ? 'split' : 'unified')}
          variant="unstyled"
          className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          title={diffStyle === 'unified' ? 'Split view' : 'Unified view'}
          aria-label={diffStyle === 'unified' ? 'Split view' : 'Unified view'}
        >
          {diffStyle === 'unified' ? (
            <Columns2 className="h-3 w-3" />
          ) : (
            <Rows2 className="h-3 w-3" />
          )}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {isLoading && (
          <div className="flex h-full items-center justify-center">
            <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
          </div>
        )}

        {!isLoading && isError && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <AlertCircle className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Failed to load diff
            </span>
            <Button
              onClick={() => refetch()}
              variant="unstyled"
              className="text-2xs text-text-tertiary underline transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary"
            >
              Retry
            </Button>
          </div>
        )}

        {!isLoading && !isError && !isGitRepo && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Not a git repository
            </span>
          </div>
        )}

        {!isLoading && !isError && isGitRepo && diffError && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {diffError}
            </span>
          </div>
        )}

        {!isLoading && !isError && isGitRepo && !diffError && !hasChanges && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {DIFF_EMPTY_LABELS[mode]}
            </span>
          </div>
        )}

        {showFiles && (
          <div className="divide-y divide-border/30 dark:divide-border-dark/30">
            {parsedFiles.map((file, i) => {
              const isExpanded = expandedFiles.has(i);
              const isRenamed = file.type === 'rename-pure' || file.type === 'rename-changed';
              return (
                <div key={i}>
                  <button
                    onClick={() => toggleFile(i)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
                        isExpanded && 'rotate-90',
                      )}
                    />
                    <FileText className="h-3 w-3 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                    <span className="min-w-0 truncate font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
                      {isRenamed && file.prevName ? (
                        <>
                          <span className="text-text-quaternary dark:text-text-dark-quaternary">
                            {file.prevName}
                          </span>
                          <span className="mx-1 text-text-quaternary dark:text-text-dark-quaternary">
                            &rarr;
                          </span>
                          {file.name}
                        </>
                      ) : (
                        file.name
                      )}
                    </span>
                    <FileStatusBadge type={file.type} />
                    <FileStats file={file} />
                  </button>
                  {isExpanded && <FileDiffRenderer file={file} options={options} />}
                </div>
              );
            })}
          </div>
        )}

        {!isLoading &&
          !isError &&
          isGitRepo &&
          hasChanges &&
          parsedFiles.length === 0 &&
          !parsingDone && (
            <div className="flex h-full items-center justify-center">
              <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
            </div>
          )}

        {!isLoading &&
          !isError &&
          isGitRepo &&
          hasChanges &&
          parsedFiles.length === 0 &&
          parsingDone && (
            <div className="flex h-full flex-col items-center justify-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
              <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                Changes detected but diff cannot be displayed
              </span>
              <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Binary or unsupported file formats
              </span>
            </div>
          )}
      </div>
    </div>
  );
});
