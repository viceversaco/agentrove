import { memo } from 'react';
import { MoreHorizontal, Loader2, Pin } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';
import type { Chat } from '@/types/chat.types';

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

interface SidebarChatItemProps {
  chat: Chat;
  isSelected: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  isChatStreaming: boolean;
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chatId: string) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
}

export const SidebarChatItem = memo(function SidebarChatItem({
  chat,
  isSelected,
  isHovered,
  isDropdownOpen,
  isChatStreaming,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: SidebarChatItemProps) {
  const isPinned = !!chat.pinned_at;

  return (
    <div
      className="group relative flex items-center"
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
    >
      <Button
        onClick={() => onSelect(chat.id)}
        variant="unstyled"
        className={cn(
          'flex-1 px-2.5 py-1.5 text-left text-xs',
          'rounded-lg transition-all duration-200',
          'flex min-w-0 items-center gap-2',
          isSelected
            ? 'bg-surface-hover text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
            : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50 dark:hover:text-text-dark-secondary',
        )}
      >
        {isChatStreaming && (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-text-tertiary dark:text-text-dark-tertiary" />
        )}
        <span className="flex-1 truncate">{chat.title}</span>
        {isPinned && (
          <Pin className="h-2.5 w-2.5 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
        )}
        <span
          className={cn(
            'flex-shrink-0 text-2xs tabular-nums text-text-quaternary dark:text-text-dark-quaternary',
            'transition-opacity duration-200',
            isHovered || isSelected || isDropdownOpen ? 'opacity-0' : 'opacity-100',
          )}
        >
          {getRelativeTime(chat.updated_at || chat.created_at)}
        </span>
      </Button>

      <Button
        onClick={(e) => onDropdownClick(e, chat.id)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={cn(
          'absolute right-1 flex-shrink-0 rounded-md p-1 transition-all duration-200',
          'text-text-quaternary dark:text-text-dark-quaternary',
          'hover:text-text-primary dark:hover:text-text-dark-primary',
          isHovered || isSelected || isDropdownOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label="Chat options"
      >
        <MoreHorizontal className="h-3 w-3" />
      </Button>
    </div>
  );
});
