import { memo } from 'react';
import { MessageRenderer } from './MessageRenderer';
import type { AssistantStreamEvent, MessageAttachment } from '@/types';
import { MessageAttachments } from './MessageAttachments';

interface SharedContentProps {
  contentRender?: {
    events?: AssistantStreamEvent[];
  };
  attachments?: MessageAttachment[];
  isStreaming: boolean;
  chatId?: string;
}

interface UserMessageContentProps extends SharedContentProps {
  uploadingAttachmentIds?: string[];
}

export const UserMessageContent = memo(function UserMessageContent({
  contentRender,
  attachments,
  uploadingAttachmentIds,
  isStreaming,
  chatId,
}: UserMessageContentProps) {
  return (
    <div className="space-y-1">
      <MessageAttachments
        attachments={attachments}
        uploadingAttachmentIds={uploadingAttachmentIds}
      />
      <MessageRenderer events={contentRender?.events} isStreaming={isStreaming} chatId={chatId} />
    </div>
  );
});

interface AssistantMessageContentProps extends SharedContentProps {
  isLastBotMessage?: boolean;
  onSuggestionSelect?: (suggestion: string) => void;
}

export const AssistantMessageContent = memo(function AssistantMessageContent({
  contentRender,
  attachments,
  isStreaming,
  chatId,
  isLastBotMessage,
  onSuggestionSelect,
}: AssistantMessageContentProps) {
  return (
    <div className="space-y-4">
      <MessageRenderer
        events={contentRender?.events}
        isStreaming={isStreaming}
        chatId={chatId}
        isLastBotMessage={isLastBotMessage}
        onSuggestionSelect={onSuggestionSelect}
      />

      <MessageAttachments attachments={attachments} className="mt-3" />
    </div>
  );
});
