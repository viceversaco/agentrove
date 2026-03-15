import { memo } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useChatSessionState, useChatSessionActions } from '@/hooks/useChatSessionContext';

interface MessageActionsProps {
  messageId: string;
  contentText: string;
  copyLabel?: string;
}

export const MessageActions = memo(function MessageActions({
  messageId,
  contentText,
  copyLabel = 'Copy',
}: MessageActionsProps) {
  const { copiedMessageId } = useChatSessionState();
  const { onCopy } = useChatSessionActions();

  return (
    <div className="flex items-center gap-0.5">
      <Tooltip content={copiedMessageId === messageId ? 'Copied!' : copyLabel} position="bottom">
        <Button
          onClick={() => onCopy(contentText, messageId)}
          variant="unstyled"
          className={`relative overflow-hidden rounded-md p-1 transition-colors duration-200 ${
            copiedMessageId === messageId
              ? 'bg-success-100 text-success-600 dark:bg-success-500/10 dark:text-success-400'
              : 'text-text-quaternary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
          }`}
        >
          {copiedMessageId === messageId ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </Tooltip>
    </div>
  );
});
