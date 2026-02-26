import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/primitives/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader';
import { useBootstrapWorkspaceMutation } from '@/hooks/queries/useWorkspaceQueries';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const RECENT_WORKSPACES_KEY = 'claudex.recent_workspaces';
const ACTIVE_WORKSPACE_KEY = 'claudex.active_workspace';
const MAX_RECENT_WORKSPACES = 8;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRecentWorkspaces(rawValue: string | null): string[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildRecentWorkspaces(nextPath: string, existing: string[]): string[] {
  const deduped = [nextPath, ...existing.filter((path) => path !== nextPath)];
  return deduped.slice(0, MAX_RECENT_WORKSPACES);
}

function getWorkspaceLabel(path: string): string {
  const normalized = path.trim();
  if (!normalized) return 'Select folder or project';
  const parts = normalized.split(/[\\/]/).filter((p) => Boolean(p) && !UUID_REGEX.test(p));
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return parts[0] || normalized;
}

interface WorkspaceSelectorProps {
  workspacePath: string;
  onWorkspaceChange: (path: string) => void;
  enabled: boolean;
}

export function WorkspaceSelector({
  workspacePath,
  onWorkspaceChange,
  enabled,
}: WorkspaceSelectorProps) {
  const isDesktop = isTauri();
  const bootstrapWorkspace = useBootstrapWorkspaceMutation();
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isGitModalOpen, setIsGitModalOpen] = useState(false);
  const [gitUrl, setGitUrl] = useState('');
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const workspaceLabel = useMemo(() => getWorkspaceLabel(workspacePath), [workspacePath]);

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!enabled || hasInitialized.current) return;
    hasInitialized.current = true;
    const saved = parseRecentWorkspaces(localStorage.getItem(RECENT_WORKSPACES_KEY));
    setRecentWorkspaces(saved);
    const active = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    if (active !== null) {
      onWorkspaceChange(active);
    } else if (saved.length > 0) {
      onWorkspaceChange(saved[0]);
    }
  }, [enabled, onWorkspaceChange]);

  useEffect(() => {
    if (!isPopoverOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!anchorRef.current?.contains(target)) {
        setIsPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isPopoverOpen]);

  const setWorkspace = useCallback(
    (path: string) => {
      const normalizedPath = path.trim();
      if (!normalizedPath) return;
      onWorkspaceChange(normalizedPath);
      localStorage.setItem(ACTIVE_WORKSPACE_KEY, normalizedPath);
      setRecentWorkspaces((prev) => {
        const next = buildRecentWorkspaces(normalizedPath, prev);
        localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [onWorkspaceChange],
  );

  const clearWorkspace = useCallback(() => {
    onWorkspaceChange('');
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, '');
    setIsPopoverOpen(false);
  }, [onWorkspaceChange]);

  const removeRecentWorkspace = useCallback(
    (pathToRemove: string) => {
      if (pathToRemove === workspacePath) {
        onWorkspaceChange('');
        localStorage.setItem(ACTIVE_WORKSPACE_KEY, '');
      }
      setRecentWorkspaces((prev) => {
        const next = prev.filter((p) => p !== pathToRemove);
        localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(next));
        return next;
      });
    },
    [workspacePath, onWorkspaceChange],
  );

  const handleChooseWorkspace = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Workspace',
    });
    if (!selected || Array.isArray(selected)) return;
    setWorkspace(selected);
    setIsPopoverOpen(false);
  }, [setWorkspace]);

  const handleCloneWorkspace = useCallback(async () => {
    const normalizedGitUrl = gitUrl.trim();
    if (!normalizedGitUrl) {
      toast.error('Enter a Git repository URL');
      return;
    }
    try {
      const response = await bootstrapWorkspace.mutateAsync({
        source_type: 'git',
        git_url: normalizedGitUrl,
      });
      setWorkspace(response.workspace_path);
      setGitUrl('');
      setIsGitModalOpen(false);
      toast.success('Repository cloned');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clone repository');
    }
  }, [bootstrapWorkspace, gitUrl, setWorkspace]);

  return (
    <>
      <div className="relative z-30 mb-2 px-4 sm:px-6" ref={anchorRef}>
        <button
          type="button"
          onClick={() => setIsPopoverOpen((prev) => !prev)}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          <span className="max-w-[16rem] truncate font-mono">{workspaceLabel}</span>
          <svg
            className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
          </svg>
        </button>

        {isPopoverOpen && (
          <div className="absolute left-4 top-9 z-40 w-[18rem] rounded-xl border border-border/50 bg-surface-secondary p-1.5 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary sm:left-6">
            <div className="flex flex-col gap-0.5">
              {workspacePath && (
                <button
                  type="button"
                  onClick={clearWorkspace}
                  className="rounded-md px-2.5 py-1.5 text-left text-2xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  No workspace
                </button>
              )}
              {isDesktop && (
                <button
                  type="button"
                  onClick={() => void handleChooseWorkspace()}
                  className="rounded-md px-2.5 py-1.5 text-left text-2xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  Browse local folder
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsPopoverOpen(false);
                  setIsGitModalOpen(true);
                }}
                className="rounded-md px-2.5 py-1.5 text-left text-2xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
              >
                Clone Git repo
              </button>
              {recentWorkspaces.length > 0 && (
                <div className="mt-0.5 border-t border-border/50 pt-0.5 dark:border-border-dark/50">
                  <p className="px-2.5 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                    Recent
                  </p>
                  {recentWorkspaces.map((path) => (
                    <div
                      key={path}
                      className="group flex w-full items-center rounded-md transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setWorkspace(path);
                          setIsPopoverOpen(false);
                        }}
                        title={path}
                        className="min-w-0 flex-1 px-2.5 py-1.5 text-left font-mono text-2xs text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                      >
                        <span className="block truncate">{getWorkspaceLabel(path)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRecentWorkspace(path);
                        }}
                        title="Remove from recent"
                        className="mr-1 flex shrink-0 items-center justify-center rounded p-0.5 text-text-quaternary opacity-0 transition-all duration-200 hover:text-text-primary group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <BaseModal
        isOpen={isGitModalOpen}
        onClose={() => {
          setIsGitModalOpen(false);
          setGitUrl('');
        }}
        size="sm"
        ariaLabel="Clone Git repository"
      >
        <ModalHeader
          title="Clone Git repo"
          onClose={() => {
            setIsGitModalOpen(false);
            setGitUrl('');
          }}
        />
        <div className="flex flex-col gap-3 p-4">
          <label className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
            Repository URL
          </label>
          <input
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCloneWorkspace();
            }}
            placeholder="https://github.com/org/repo.git"
            autoFocus
            className="h-9 rounded-lg border border-border/50 bg-surface-secondary px-3 font-mono text-xs text-text-primary outline-none transition-colors duration-200 placeholder:text-text-quaternary focus-visible:border-border-hover focus-visible:ring-1 focus-visible:ring-text-quaternary/30 dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsGitModalOpen(false);
                setGitUrl('');
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleCloneWorkspace()}
              isLoading={bootstrapWorkspace.isPending}
            >
              Clone
            </Button>
          </div>
        </div>
      </BaseModal>
    </>
  );
}
