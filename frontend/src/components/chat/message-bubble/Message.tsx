import { memo, useMemo } from 'react';
import { UserMessageContent, AssistantMessageContent } from './MessageContent';
import { MessageActions } from './MessageActions';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import type { AssistantStreamEvent, MessageAttachment } from '@/types/chat.types';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatRelativeTime, formatFullTimestamp } from '@/utils/date';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';

interface SharedContentProps {
  contentRender?: {
    events?: AssistantStreamEvent[];
  };
  attachments?: MessageAttachment[];
  isStreaming: boolean;
}

export interface UserMessageProps extends SharedContentProps {
  id: string;
  contentText: string;
  uploadingAttachmentIds?: string[];
}

export const UserMessage = memo(function UserMessage({
  id,
  contentText,
  contentRender,
  attachments,
  uploadingAttachmentIds,
  isStreaming,
}: UserMessageProps) {
  const { chatId } = useChatContext();

  return (
    <div className="group px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="inline-block max-w-full rounded-xl bg-surface-hover/60 px-3 py-1.5 dark:bg-surface-dark-tertiary/80">
            <div className="max-w-none break-words text-sm text-text-primary dark:text-text-dark-primary">
              <UserMessageContent
                contentRender={contentRender}
                attachments={attachments}
                uploadingAttachmentIds={uploadingAttachmentIds}
                isStreaming={isStreaming}
                chatId={chatId}
              />
            </div>
          </div>

          {contentText.trim() && !isStreaming && (
            <div className="mt-1">
              <MessageActions messageId={id} contentText={contentText} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export interface AssistantMessageProps extends SharedContentProps {
  contentText: string;
  id: string;
  createdAt?: string;
  modelId?: string;
  isLastBotMessage?: boolean;
}

export const AssistantMessage = memo(function AssistantMessage({
  id,
  contentText,
  contentRender,
  attachments,
  isStreaming,
  createdAt,
  modelId,
  isLastBotMessage,
}: AssistantMessageProps) {
  const { chatId } = useChatContext();
  const { setInputMessage } = useChatInputMessageContext();
  const onSuggestionSelect = isLastBotMessage ? setInputMessage : undefined;
  const modelMap = useModelMap();

  const relativeTime = createdAt ? formatRelativeTime(createdAt) : '';
  const fullTimestamp = createdAt ? formatFullTimestamp(createdAt) : '';
  const modelName = useMemo(() => {
    if (!modelId) return null;
    const model = modelMap.get(modelId);
    if (model?.name) return model.name;
    return modelId.includes(':') ? modelId.split(':').pop()! : modelId;
  }, [modelId, modelMap]);

  return (
    <div className="group px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="max-w-none break-words text-sm text-text-primary dark:text-text-dark-primary">
            <AssistantMessageContent
              contentRender={contentRender}
              attachments={attachments}
              isStreaming={isStreaming}
              chatId={chatId}
              isLastBotMessage={isLastBotMessage}
              onSuggestionSelect={onSuggestionSelect}
            />
          </div>

          {contentText.trim() && !isStreaming && (
            <div className="mt-2 flex items-center justify-between">
              <MessageActions messageId={id} contentText={contentText} />

              <div className="flex items-center gap-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {modelName && <span>{modelName}</span>}
                {modelName && relativeTime && <span>·</span>}
                {relativeTime && (
                  <Tooltip content={fullTimestamp} position="bottom">
                    <span className="cursor-default">{relativeTime}</span>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
