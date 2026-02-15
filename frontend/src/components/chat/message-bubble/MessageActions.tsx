import { memo, useCallback, useState } from 'react';
import { CheckCircle2, Copy, GitFork, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useForkChatMutation, useRestoreCheckpointMutation } from '@/hooks/queries/useChatQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { Tooltip } from '@/components/ui/Tooltip';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import toast from 'react-hot-toast';

interface MessageActionsProps {
  messageId: string;
  contentText: string;
  isLastBotMessageWithCommit?: boolean;
}

export const MessageActions = memo(function MessageActions({
  messageId,
  contentText,
  isLastBotMessageWithCommit,
}: MessageActionsProps) {
  const { chatId, sandboxId } = useChatContext();
  const { state, actions } = useChatSessionContext();
  const copiedMessageId = state.copiedMessageId;
  const isGloballyStreaming = state.isStreaming;
  const { onCopy, onRestoreSuccess } = actions;
  const { data: settings } = useSettingsQuery();
  const sandboxProvider = settings?.sandbox_provider ?? 'docker';
  const navigate = useNavigate();
  const [isRestoring, setIsRestoring] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const restoreMutation = useRestoreCheckpointMutation({
    onSuccess: () => {
      setIsRestoring(false);
      setShowConfirmDialog(false);
      toast.success('Checkpoint restored successfully');
      onRestoreSuccess?.();
    },
    onError: () => {
      toast.error('Failed to restore checkpoint. Please try again.');
      setIsRestoring(false);
      setShowConfirmDialog(false);
    },
  });

  const forkMutation = useForkChatMutation({
    onSuccess: (data) => {
      setIsForking(false);
      toast.success(`Chat forked with ${data.messages_copied} messages`);
      navigate(`/chat/${data.chat.id}`);
    },
    onError: () => {
      toast.error('Failed to fork chat. Please try again.');
      setIsForking(false);
    },
  });

  const handleRestore = useCallback(() => {
    if (!chatId || isRestoring) return;
    setShowConfirmDialog(true);
  }, [chatId, isRestoring]);

  const handleConfirmRestore = useCallback(() => {
    if (!chatId || !messageId) return;
    setIsRestoring(true);
    restoreMutation.mutate({ chatId, messageId, sandboxId });
  }, [chatId, messageId, sandboxId, restoreMutation]);

  const handleFork = useCallback(() => {
    if (!chatId || isForking) return;
    setIsForking(true);
    forkMutation.mutate({ chatId, messageId });
  }, [chatId, messageId, isForking, forkMutation]);

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Tooltip content={copiedMessageId === messageId ? 'Copied!' : 'Copy'} position="bottom">
          <Button
            onClick={() => onCopy(contentText, messageId)}
            variant="unstyled"
            className={`relative overflow-hidden rounded-md p-1 transition-all duration-200 ${
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

        {!isLastBotMessageWithCommit && (
          <>
            <Tooltip content={isRestoring ? 'Restoring...' : 'Restore'} position="bottom">
              <Button
                onClick={handleRestore}
                disabled={isRestoring || isGloballyStreaming}
                variant="unstyled"
                className={`relative rounded-md p-1 transition-all duration-200 ${
                  isRestoring || isGloballyStreaming
                    ? 'cursor-not-allowed opacity-50'
                    : 'text-text-quaternary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
                }`}
              >
                {isRestoring ? <Spinner size="sm" /> : <RotateCcw className="h-3.5 w-3.5" />}
              </Button>
            </Tooltip>

            {sandboxProvider === 'docker' && sandboxId && (
              <Tooltip content={isForking ? 'Forking...' : 'Fork'} position="bottom">
                <Button
                  onClick={handleFork}
                  disabled={isForking || isGloballyStreaming}
                  variant="unstyled"
                  className={`relative rounded-md p-1 transition-all duration-200 ${
                    isForking || isGloballyStreaming
                      ? 'cursor-not-allowed opacity-50'
                      : 'text-text-quaternary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
                  }`}
                >
                  {isForking ? <Spinner size="sm" /> : <GitFork className="h-3.5 w-3.5" />}
                </Button>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleConfirmRestore}
        title="Restore to This Message"
        message="Restore conversation to this message? Newer messages will be deleted."
        confirmLabel="Restore"
        cancelLabel="Cancel"
      />

      <LoadingOverlay isOpen={isRestoring} message="Restoring checkpoint..." />
      <LoadingOverlay isOpen={isForking} message="Forking chat..." />
    </>
  );
});
