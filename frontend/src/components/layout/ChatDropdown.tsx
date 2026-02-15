import { memo, type Ref } from 'react';
import { Edit2, Trash2, Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';
import type { Chat } from '@/types/chat.types';

interface ChatDropdownProps {
  ref?: Ref<HTMLDivElement>;
  chat: Chat;
  position: { top: number; left: number };
  onRename: (chat: Chat) => void;
  onDelete: (chatId: string) => void;
  onTogglePin: (chat: Chat) => void;
}

export const ChatDropdown = memo(function ChatDropdown({
  ref,
  chat,
  position,
  onRename,
  onDelete,
  onTogglePin,
}: ChatDropdownProps) {
  const isPinned = !!chat.pinned_at;

  return (
    <div
      ref={ref}
      className={cn(
        'fixed w-32',
        'bg-surface dark:bg-surface-dark',
        'border border-border dark:border-border-dark',
        'z-50 overflow-hidden rounded-lg shadow-medium',
      )}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <Button
        onClick={() => onTogglePin(chat)}
        variant="unstyled"
        className={cn(
          'w-full px-3 py-2 text-left text-xs',
          'text-text-primary dark:text-text-dark-primary',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'flex items-center gap-2 transition-colors',
        )}
      >
        {isPinned ? (
          <>
            <PinOff className="h-3 w-3" />
            Unpin
          </>
        ) : (
          <>
            <Pin className="h-3 w-3" />
            Pin
          </>
        )}
      </Button>
      <Button
        onClick={() => onRename(chat)}
        variant="unstyled"
        className={cn(
          'w-full px-3 py-2 text-left text-xs',
          'text-text-primary dark:text-text-dark-primary',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'flex items-center gap-2 transition-colors',
        )}
      >
        <Edit2 className="h-3 w-3" />
        Rename
      </Button>
      <Button
        onClick={() => onDelete(chat.id)}
        variant="unstyled"
        className={cn(
          'w-full px-3 py-2 text-left text-xs',
          'text-error-600 dark:text-error-400',
          'hover:bg-error-50 dark:hover:bg-error-900/20',
          'flex items-center gap-2 transition-colors',
        )}
      >
        <Trash2 className="h-3 w-3" />
        Delete
      </Button>
    </div>
  );
});
