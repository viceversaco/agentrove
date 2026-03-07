import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, ChevronRight, MoreHorizontal, MessageSquarePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useInView } from 'react-intersection-observer';
import type { FetchNextPageOptions } from '@tanstack/react-query';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal';
import {
  useDeleteChatMutation,
  useUpdateChatMutation,
  usePinChatMutation,
} from '@/hooks/queries/useChatQueries';
import {
  useDeleteWorkspaceMutation,
  useUpdateWorkspaceMutation,
} from '@/hooks/queries/useWorkspaceQueries';
import { cn } from '@/utils/cn';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { SidebarChatItem } from './SidebarChatItem';
import { ChatDropdown } from './ChatDropdown';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';

function calculateDropdownPosition(buttonRect: DOMRect): { top: number; left: number } {
  const isMobile = window.innerWidth < 640;
  const spaceBelow = window.innerHeight - buttonRect.bottom;
  const spaceRight = window.innerWidth - buttonRect.right;

  let top: number;
  let left: number;

  if (isMobile) {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.bottom + 4
        : buttonRect.top - DROPDOWN_HEIGHT - 4;
    left = buttonRect.right - DROPDOWN_WIDTH;
  } else {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.top
        : buttonRect.top - DROPDOWN_HEIGHT + buttonRect.height;
    left =
      spaceRight >= DROPDOWN_WIDTH + DROPDOWN_MARGIN
        ? buttonRect.right + 4
        : buttonRect.left - DROPDOWN_WIDTH - 4;
  }

  top = Math.max(
    DROPDOWN_MARGIN,
    Math.min(top, window.innerHeight - DROPDOWN_HEIGHT - DROPDOWN_MARGIN),
  );
  left = Math.max(
    DROPDOWN_MARGIN,
    Math.min(left, window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_MARGIN),
  );

  return { top, left };
}

interface WorkspaceGroup {
  workspace: Workspace;
  chats: Chat[];
  latestActivity: number;
}

function groupChatsByWorkspace(chats: Chat[], workspaces: Workspace[]): WorkspaceGroup[] {
  const workspaceMap = new Map<string, Workspace>();
  for (const ws of workspaces) {
    workspaceMap.set(ws.id, ws);
  }

  const groups = new Map<string, Chat[]>();
  for (const chat of chats) {
    if (!chat.workspace_id) continue;
    if (!groups.has(chat.workspace_id)) groups.set(chat.workspace_id, []);
    groups.get(chat.workspace_id)!.push(chat);
  }

  const result: WorkspaceGroup[] = [];
  for (const [workspaceId, groupChats] of groups) {
    const workspace = workspaceMap.get(workspaceId);
    if (!workspace) continue;
    const latestActivity = Math.max(
      ...groupChats.map((c) => new Date(c.updated_at || c.created_at).getTime()),
    );
    result.push({ workspace, chats: groupChats, latestActivity });
  }

  for (const ws of workspaces) {
    if (!groups.has(ws.id)) {
      result.push({
        workspace: ws,
        chats: [],
        latestActivity: new Date(ws.updated_at || ws.created_at).getTime(),
      });
    }
  }

  result.sort((a, b) => b.latestActivity - a.latestActivity);
  return result;
}

export interface SidebarProps {
  chats: Chat[];
  workspaces: Workspace[];
  selectedChatId: string | null;
  onChatSelect: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
  hasNextPage?: boolean;
  fetchNextPage?: (options?: FetchNextPageOptions) => unknown;
  isFetchingNextPage?: boolean;
}

export function Sidebar({
  chats,
  workspaces,
  selectedChatId,
  onChatSelect,
  onDeleteChat,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: SidebarProps) {
  const navigate = useNavigate();
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const isMobile = useIsMobile();
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(new Set());
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [chatToRename, setChatToRename] = useState<Chat | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null);
  const [workspaceToRename, setWorkspaceToRename] = useState<Workspace | null>(null);
  const [dropdown, setDropdown] = useState<{
    chatId: string;
    position: { top: number; left: number };
  } | null>(null);
  const [workspaceDropdown, setWorkspaceDropdown] = useState<{
    workspaceId: string;
    position: { top: number; left: number };
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const workspaceDropdownRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const deleteChat = useDeleteChatMutation();
  const updateChat = useUpdateChatMutation();
  const pinChat = usePinChatMutation();
  const deleteWorkspace = useDeleteWorkspaceMutation();
  const updateWorkspace = useUpdateWorkspaceMutation();

  const dropdownChat = useMemo(() => {
    if (!dropdown) return null;
    return chats.find((c) => c.id === dropdown.chatId) || null;
  }, [dropdown, chats]);

  const { ref: loadMoreRef, inView } = useInView();

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage?.();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { pinnedChats, workspaceGroups } = useMemo(() => {
    const pinned = chats.filter((chat) => !!chat.pinned_at);
    const unpinned = chats.filter((chat) => !chat.pinned_at);
    return {
      pinnedChats: pinned,
      workspaceGroups: groupChatsByWorkspace(unpinned, workspaces),
    };
  }, [chats, workspaces]);

  const hasAnyChats = pinnedChats.length > 0 || workspaceGroups.length > 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdown(null);
      }
      if (
        workspaceDropdownRef.current &&
        !workspaceDropdownRef.current.contains(event.target as Node) &&
        !(event.target as HTMLElement).closest('[data-ws-dropdown-trigger]')
      ) {
        setWorkspaceDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dropdownStateRef = useRef(dropdown);
  dropdownStateRef.current = dropdown;
  const wsDropdownStateRef = useRef(workspaceDropdown);
  wsDropdownStateRef.current = workspaceDropdown;

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      if (dropdownStateRef.current) setDropdown(null);
      if (wsDropdownStateRef.current) setWorkspaceDropdown(null);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const handleChatSelect = useCallback(
    (chatId: string) => {
      onChatSelect(chatId);
      setHoveredChatId(null);
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [onChatSelect, isMobile],
  );

  const handleDeleteChat = useCallback((chatId: string) => {
    setChatToDelete(chatId);
    setDropdown(null);
  }, []);

  const handleMouseEnter = useCallback((chatId: string) => {
    setHoveredChatId(chatId);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredChatId(null);
  }, []);

  const confirmDeleteChat = useCallback(async () => {
    if (chatToDelete) {
      try {
        await deleteChat.mutateAsync(chatToDelete);
        toast.success('Chat deleted successfully');

        if (chatToDelete === selectedChatId) {
          navigate('/');
        }

        onDeleteChat?.(chatToDelete);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete chat');
      } finally {
        setChatToDelete(null);
      }
    }
  }, [chatToDelete, deleteChat, selectedChatId, navigate, onDeleteChat]);

  const handleNewChat = useCallback(() => {
    navigate('/');
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [navigate, isMobile]);

  const handleDropdownClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, chatId: string) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();

      setHoveredChatId(null);

      setDropdown((prev) => {
        if (prev?.chatId === chatId) {
          return null;
        }

        const position = calculateDropdownPosition(rect);
        return { chatId, position };
      });
    },
    [],
  );

  const handleRenameClick = useCallback((chat: Chat) => {
    setChatToRename(chat);
    setDropdown(null);
  }, []);

  const handleSaveRename = useCallback(
    async (newTitle: string) => {
      if (!chatToRename) return;

      try {
        await updateChat.mutateAsync({
          chatId: chatToRename.id,
          updateData: { title: newTitle },
        });
        toast.success('Chat renamed successfully');
        setChatToRename(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to rename chat');
        throw error;
      }
    },
    [chatToRename, updateChat],
  );

  const handleTogglePin = useCallback(
    async (chat: Chat) => {
      setDropdown(null);
      const isPinned = !!chat.pinned_at;
      try {
        await pinChat.mutateAsync({ chatId: chat.id, pinned: !isPinned });
        toast.success(isPinned ? 'Chat unpinned' : 'Chat pinned');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update pin status');
      }
    },
    [pinChat],
  );

  const toggleWorkspaceCollapse = useCallback((workspaceId: string) => {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const handleNewWorkspaceThread = useCallback(
    (e: React.MouseEvent, workspaceId: string) => {
      e.stopPropagation();
      navigate('/', { state: { workspaceId } });
      if (isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
    },
    [navigate, isMobile],
  );

  const handleWorkspaceContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setWorkspaceDropdown((prev) => {
        if (prev?.workspaceId === workspaceId) return null;
        const position = calculateDropdownPosition(rect);
        return { workspaceId, position };
      });
    },
    [],
  );

  const handleRenameWorkspace = useCallback((workspace: Workspace) => {
    setWorkspaceToRename(workspace);
    setWorkspaceDropdown(null);
  }, []);

  const handleSaveWorkspaceRename = useCallback(
    async (newName: string) => {
      if (!workspaceToRename) return;
      try {
        await updateWorkspace.mutateAsync({
          workspaceId: workspaceToRename.id,
          data: { name: newName },
        });
        toast.success('Workspace renamed');
        setWorkspaceToRename(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to rename workspace');
        throw error;
      }
    },
    [workspaceToRename, updateWorkspace],
  );

  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    setWorkspaceToDelete(workspaceId);
    setWorkspaceDropdown(null);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!workspaceToDelete) return;
    try {
      await deleteWorkspace.mutateAsync(workspaceToDelete);
      toast.success('Workspace deleted');

      if (selectedChatId) {
        const selectedChat = chats.find((c) => c.id === selectedChatId);
        if (selectedChat?.workspace_id === workspaceToDelete) {
          navigate('/');
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete workspace');
    } finally {
      setWorkspaceToDelete(null);
    }
  }, [workspaceToDelete, deleteWorkspace, chats, selectedChatId, navigate]);

  return (
    <>
      <aside
        aria-label="Chat history"
        className={cn(
          'absolute left-0 top-0 h-full w-64',
          'border-r border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary',
          'z-40 flex flex-col transition-transform duration-500 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="border-b border-border px-3 py-3 dark:border-border-dark">
          <Button
            onClick={handleNewChat}
            variant="unstyled"
            className={cn(
              'w-full px-3 py-2',
              'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
              'border border-border dark:border-border-dark',
              'text-text-secondary dark:text-text-dark-secondary',
              'rounded-lg transition-colors duration-200',
              'flex items-center justify-center gap-1.5 text-xs font-medium',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            New thread
          </Button>
        </div>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 pt-1">
          {!hasAnyChats ? (
            <p className="py-8 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No chats yet
            </p>
          ) : (
            <div>
              {pinnedChats.length > 0 && (
                <div className="mb-1">
                  <div className="px-2.5 pb-1 pt-2">
                    <span className="text-2xs font-medium uppercase tracking-widest text-text-quaternary dark:text-text-dark-quaternary">
                      Pinned
                    </span>
                  </div>
                  <div className="space-y-px">
                    {pinnedChats.map((chat) => (
                      <SidebarChatItem
                        key={chat.id}
                        chat={chat}
                        isSelected={chat.id === selectedChatId}
                        isHovered={hoveredChatId === chat.id}
                        isDropdownOpen={dropdown?.chatId === chat.id}
                        isChatStreaming={streamingChatIdSet.has(chat.id)}
                        onSelect={handleChatSelect}
                        onDropdownClick={handleDropdownClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ))}
                  </div>
                </div>
              )}

              {workspaceGroups.map((group) => {
                const isCollapsed = collapsedWorkspaces.has(group.workspace.id);
                return (
                  <div key={group.workspace.id} className="mb-1">
                    <div className="group flex items-center gap-0.5 px-1 pb-0.5 pt-2">
                      <button
                        type="button"
                        onClick={() => toggleWorkspaceCollapse(group.workspace.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
                      >
                        <ChevronRight
                          className={cn(
                            'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
                            !isCollapsed && 'rotate-90',
                          )}
                        />
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                        <span className="truncate text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
                          {group.workspace.name}
                        </span>
                      </button>
                      <button
                        type="button"
                        title="New thread"
                        onClick={(e) => handleNewWorkspaceThread(e, group.workspace.id)}
                        className="flex shrink-0 items-center justify-center rounded p-0.5 text-text-quaternary opacity-0 transition-all duration-200 hover:text-text-primary group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        data-ws-dropdown-trigger
                        onClick={(e) => handleWorkspaceContextMenu(e, group.workspace.id)}
                        className="flex shrink-0 items-center justify-center rounded p-0.5 text-text-quaternary opacity-0 transition-all duration-200 hover:text-text-primary group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="space-y-px pl-6">
                        {group.chats.length === 0 ? (
                          <p className="px-2.5 py-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                            No threads
                          </p>
                        ) : (
                          group.chats.map((chat) => (
                            <SidebarChatItem
                              key={chat.id}
                              chat={chat}
                              isSelected={chat.id === selectedChatId}
                              isHovered={hoveredChatId === chat.id}
                              isDropdownOpen={dropdown?.chatId === chat.id}
                              isChatStreaming={streamingChatIdSet.has(chat.id)}
                              onSelect={handleChatSelect}
                              onDropdownClick={handleDropdownClick}
                              onMouseEnter={handleMouseEnter}
                              onMouseLeave={handleMouseLeave}
                            />
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {hasNextPage && (
                <div ref={loadMoreRef} className="py-2 text-center">
                  {isFetchingNextPage ? (
                    <div className="flex items-center justify-center gap-2 text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      <Spinner size="xs" />
                    </div>
                  ) : (
                    <div className="h-4" />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {dropdown && dropdownChat && (
        <ChatDropdown
          ref={dropdownRef}
          chat={dropdownChat}
          position={dropdown.position}
          onRename={handleRenameClick}
          onDelete={handleDeleteChat}
          onTogglePin={handleTogglePin}
          onClose={() => setDropdown(null)}
        />
      )}

      {workspaceDropdown && (
        <div
          ref={workspaceDropdownRef}
          className="fixed z-50 w-40 rounded-xl border border-border/50 bg-surface-secondary p-1 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary"
          style={{
            top: workspaceDropdown.position.top,
            left: workspaceDropdown.position.left,
          }}
        >
          <button
            type="button"
            onClick={() => {
              const ws = workspaces.find((w) => w.id === workspaceDropdown.workspaceId);
              if (ws) handleRenameWorkspace(ws);
            }}
            className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => handleDeleteWorkspace(workspaceDropdown.workspaceId)}
            className="text-error dark:text-error-dark w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
          >
            Delete
          </button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!chatToDelete}
        onClose={() => setChatToDelete(null)}
        onConfirm={confirmDeleteChat}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <ConfirmDialog
        isOpen={!!workspaceToDelete}
        onClose={() => setWorkspaceToDelete(null)}
        onConfirm={confirmDeleteWorkspace}
        title="Delete Workspace"
        message="Are you sure you want to delete this workspace and all its chats? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <RenameModal
        isOpen={!!chatToRename}
        onClose={() => setChatToRename(null)}
        onSave={handleSaveRename}
        currentTitle={chatToRename?.title || ''}
        isLoading={updateChat.isPending}
      />

      <RenameModal
        isOpen={!!workspaceToRename}
        onClose={() => setWorkspaceToRename(null)}
        onSave={handleSaveWorkspaceRename}
        currentTitle={workspaceToRename?.name || ''}
        isLoading={updateWorkspace.isPending}
      />
    </>
  );
}
