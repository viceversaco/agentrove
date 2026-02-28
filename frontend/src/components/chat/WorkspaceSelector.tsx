import { useState, useCallback, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { FolderOpen, Search, GitBranch, Plus, Box, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader';
import {
  useWorkspacesQuery,
  useCreateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import type { Workspace } from '@/types/workspace.types';
import { formatRelativeTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const VISIBLE_LIMIT = 5;

type CreationMode = 'none' | 'menu' | 'empty' | 'git';

function ProviderToggle({
  value,
  onChange,
}: {
  value: 'docker' | 'host';
  onChange: (v: 'docker' | 'host') => void;
}) {
  const btnCls = (active: boolean) =>
    cn(
      'rounded-md px-2 py-0.5 text-2xs transition-colors duration-200',
      active
        ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
        : 'text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
    );
  return (
    <div className="flex items-center gap-1">
      <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        Provider:
      </span>
      <button type="button" onClick={() => onChange('host')} className={btnCls(value === 'host')}>
        Host
      </button>
      <button
        type="button"
        onClick={() => onChange('docker')}
        className={btnCls(value === 'docker')}
      >
        Docker
      </button>
    </div>
  );
}

function sourceIcon(sourceType: string | null | undefined) {
  const cls = 'mt-0.5 h-3.5 w-3.5 shrink-0 text-text-quaternary dark:text-text-dark-quaternary';
  switch (sourceType) {
    case 'git':
      return <GitBranch className={cls} />;
    case 'local':
      return <HardDrive className={cls} />;
    default:
      return <Box className={cls} />;
  }
}

interface WorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  enabled: boolean;
  chatCountByWorkspace?: Map<string, number>;
}

export function WorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
  enabled,
  chatCountByWorkspace,
}: WorkspaceSelectorProps) {
  const isDesktop = isTauri();
  const { data: workspacesData } = useWorkspacesQuery({ enabled });
  const { data: settings } = useSettingsQuery({ enabled });
  const createWorkspace = useCreateWorkspaceMutation();

  const defaultProvider = settings?.sandbox_provider ?? 'docker';

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('none');
  const [emptyName, setEmptyName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [sandboxProvider, setSandboxProvider] = useState<'docker' | 'host'>(defaultProvider);

  useEffect(() => {
    setSandboxProvider(defaultProvider);
  }, [defaultProvider]);

  const workspaces = workspacesData?.items ?? [];
  const selectedWorkspace = workspaces.find((ws) => ws.id === selectedWorkspaceId);
  const showSearch = workspaces.length > VISIBLE_LIMIT;

  const visibleWorkspaces = useMemo(() => {
    if (!searchQuery) return workspaces;
    const query = searchQuery.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(query));
  }, [workspaces, searchQuery]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchQuery('');
    setCreationMode('none');
    setEmptyName('');
    setGitUrl('');
    setSandboxProvider(defaultProvider);
  }, [defaultProvider]);

  const selectWorkspace = useCallback(
    (workspace: Workspace) => {
      onWorkspaceChange(workspace.id);
      closeModal();
    },
    [onWorkspaceChange, closeModal],
  );

  const handleCreateEmpty = useCallback(async () => {
    const name = emptyName.trim() || 'Untitled';
    try {
      const workspace = await createWorkspace.mutateAsync({
        name,
        source_type: 'empty',
        sandbox_provider: sandboxProvider,
      });
      onWorkspaceChange(workspace.id);
      closeModal();
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, emptyName, sandboxProvider, onWorkspaceChange, closeModal]);

  const handleChooseLocal = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Workspace Folder',
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const name = selected.split(/[\\/]/).filter(Boolean).pop() || 'Local';
      const workspace = await createWorkspace.mutateAsync({
        name,
        source_type: 'local',
        workspace_path: selected,
        sandbox_provider: sandboxProvider,
      });
      onWorkspaceChange(workspace.id);
      closeModal();
      toast.success('Workspace created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create workspace');
    }
  }, [createWorkspace, sandboxProvider, onWorkspaceChange, closeModal]);

  const handleCloneGit = useCallback(async () => {
    const normalizedGitUrl = gitUrl.trim();
    if (!normalizedGitUrl) {
      toast.error('Enter a Git repository URL');
      return;
    }
    try {
      const workspace = await createWorkspace.mutateAsync({
        name: normalizedGitUrl.split('/').pop()?.replace('.git', '') || 'Git Project',
        source_type: 'git',
        git_url: normalizedGitUrl,
        sandbox_provider: sandboxProvider,
      });
      onWorkspaceChange(workspace.id);
      closeModal();
      toast.success('Repository cloned');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clone repository');
    }
  }, [createWorkspace, gitUrl, sandboxProvider, onWorkspaceChange, closeModal]);

  const label = selectedWorkspace?.name || 'Select workspace';

  return (
    <>
      <div className="relative z-30 mb-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          <FolderOpen className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          <span className="max-w-[16rem] truncate">{label}</span>
          <svg
            className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z" />
          </svg>
        </button>
      </div>

      <BaseModal isOpen={isModalOpen} onClose={closeModal} size="md" ariaLabel="Select workspace">
        <ModalHeader title="Workspaces" onClose={closeModal} />

        <div className="flex flex-col">
          {showSearch && (
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-quaternary dark:text-text-dark-quaternary" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces…"
                  autoFocus
                  className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 pl-8 pr-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
              </div>
            </div>
          )}

          <div className="max-h-[20rem] overflow-y-auto px-3 py-2">
            {visibleWorkspaces.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
                {searchQuery ? 'No workspaces found' : 'No workspaces yet'}
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {visibleWorkspaces.map((ws) => {
                  const chatCount = chatCountByWorkspace?.get(ws.id) ?? 0;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => selectWorkspace(ws)}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200',
                        ws.id === selectedWorkspaceId
                          ? 'bg-surface-active dark:bg-surface-dark-active'
                          : 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                      )}
                    >
                      {sourceIcon(ws.source_type)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs text-text-primary dark:text-text-dark-primary">
                            {ws.name}
                          </span>
                          <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
                            {ws.source_type ?? 'empty'}
                          </span>
                          <span className="shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
                            {ws.sandbox_provider === 'host' ? 'host' : 'docker'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                          <span>{formatRelativeTime(ws.updated_at)}</span>
                          {chatCount > 0 && (
                            <>
                              <span>·</span>
                              <span>
                                {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 px-4 py-3 dark:border-border-dark/50">
            {creationMode === 'none' ? (
              <button
                type="button"
                onClick={() => setCreationMode('menu')}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
              >
                <Plus className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                New workspace
              </button>
            ) : creationMode === 'empty' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-dark-secondary">
                  <Box className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Empty workspace
                </div>
                <input
                  value={emptyName}
                  onChange={(e) => setEmptyName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreateEmpty();
                  }}
                  placeholder="Workspace name"
                  autoFocus
                  className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 px-3 text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
                <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreationMode('menu');
                      setEmptyName('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCreateEmpty()}
                    isLoading={createWorkspace.isPending}
                  >
                    Create
                  </Button>
                </div>
              </div>
            ) : creationMode === 'git' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-text-secondary dark:text-text-dark-secondary">
                  <GitBranch className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Clone Git repo
                </div>
                <input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCloneGit();
                  }}
                  placeholder="https://github.com/org/repo.git"
                  autoFocus
                  className="bg-surface-primary dark:bg-surface-dark-primary h-8 w-full rounded-lg border border-border/50 px-3 font-mono text-xs text-text-primary outline-none placeholder:text-text-quaternary focus-visible:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus-visible:border-border-dark-hover"
                />
                <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCreationMode('menu');
                      setGitUrl('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleCloneGit()}
                    isLoading={createWorkspace.isPending}
                  >
                    Clone
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <div className="px-2.5 py-1.5">
                  <ProviderToggle value={sandboxProvider} onChange={setSandboxProvider} />
                </div>
                <button
                  type="button"
                  onClick={() => setCreationMode('empty')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  <Box className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Empty workspace
                </button>
                {isDesktop && (
                  <button
                    type="button"
                    onClick={() => void handleChooseLocal()}
                    disabled={createWorkspace.isPending}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                  >
                    <HardDrive className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                    Local folder
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setCreationMode('git')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  <GitBranch className="h-3.5 w-3.5 text-text-quaternary dark:text-text-dark-quaternary" />
                  Clone Git repo
                </button>
              </div>
            )}
          </div>
        </div>
      </BaseModal>
    </>
  );
}
