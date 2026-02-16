import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useInView } from 'react-intersection-observer';
import type { FetchNextPageOptions } from '@tanstack/react-query';
import type { Chat } from '@/types/chat.types';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal';
import {
  useDeleteChatMutation,
  useUpdateChatMutation,
  usePinChatMutation,
} from '@/hooks/queries/useChatQueries';
import { cn } from '@/utils/cn';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { SidebarChatItem } from './SidebarChatItem';
import { ChatDropdown } from './ChatDropdown';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'Previous 7 days';
  return 'Older';
}

function groupChatsByDate(chats: Chat[]): { label: string; chats: Chat[] }[] {
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
  const groups = new Map<string, Chat[]>();

  for (const chat of chats) {
    const group = getDateGroup(chat.updated_at || chat.created_at);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(chat);
  }

  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, chats: groups.get(label)! }));
}

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

export interface SidebarProps {
  chats: Chat[];
  selectedChatId: string | null;
  onChatSelect: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
  hasNextPage?: boolean;
  fetchNextPage?: (options?: FetchNextPageOptions) => unknown;
  isFetchingNextPage?: boolean;
}

export function Sidebar({
  chats,
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
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [chatToRename, setChatToRename] = useState<Chat | null>(null);
  const [dropdown, setDropdown] = useState<{
    chatId: string;
    position: { top: number; left: number };
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const deleteChat = useDeleteChatMutation();
  const updateChat = useUpdateChatMutation();
  const pinChat = usePinChatMutation();

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

  const { pinnedChats, unpinnedGroups } = useMemo(() => {
    return {
      pinnedChats: chats.filter((chat) => !!chat.pinned_at),
      unpinnedGroups: groupChatsByDate(chats.filter((chat) => !chat.pinned_at)),
    };
  }, [chats]);

  const hasAnyChats = pinnedChats.length > 0 || unpinnedGroups.length > 0;

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
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const handleScroll = () => {
      if (dropdown) {
        setDropdown(null);
      }
    };

    scrollContainer?.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer?.removeEventListener('scroll', handleScroll);
  }, [dropdown]);

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

  const confirmDeleteChat = async () => {
    if (chatToDelete) {
      try {
        await deleteChat.mutateAsync(chatToDelete);
        toast.success('Chat deleted successfully');

        if (chatToDelete === selectedChatId) {
          navigate('/');
        }

        if (onDeleteChat) {
          onDeleteChat(chatToDelete);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to delete chat');
      } finally {
        setChatToDelete(null);
      }
    }
  };

  const handleNewChat = () => {
    navigate('/');
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  };

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

  const handleRenameClick = (chat: Chat) => {
    setChatToRename(chat);
    setDropdown(null);
  };

  const handleSaveRename = async (newTitle: string) => {
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
  };

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

  return (
    <>
      <aside
        className={cn(
          'absolute top-0 h-full w-64',
          'border-r border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary',
          'z-40 flex flex-col transition-[left] duration-500 ease-in-out',
          sidebarOpen ? 'left-0' : '-left-64',
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

              {unpinnedGroups.map((group) => (
                <div key={group.label} className="mb-1">
                  <div className="px-2.5 pb-1 pt-2">
                    <span className="text-2xs font-medium uppercase tracking-widest text-text-quaternary dark:text-text-dark-quaternary">
                      {group.label}
                    </span>
                  </div>
                  <div className="space-y-px">
                    {group.chats.map((chat) => (
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
              ))}

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
        />
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

      <RenameModal
        isOpen={!!chatToRename}
        onClose={() => setChatToRename(null)}
        onSave={handleSaveRename}
        currentTitle={chatToRename?.title || ''}
        isLoading={updateChat.isPending}
      />
    </>
  );
}
