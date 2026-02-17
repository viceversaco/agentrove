import { useEffect, useRef } from 'react';
import { detectFileType } from '@/utils/fileTypes';
import { createInitialMessage } from '@/utils/message';
import { chatStorage } from '@/utils/storage';
import type { Message } from '@/types/chat.types';

interface UseMessageInitializationParams {
  fetchedMessages: Message[];
  chatId: string | undefined;
  selectedModelId: string | null | undefined;
  hasMessages: boolean;
  initialPromptFromRoute: string | null;
  initialPromptSent: boolean;
  wasAborted: boolean;
  attachedFiles: File[];
  isLoading: boolean;
  isStreaming: boolean;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setInitialPrompt: (prompt: string) => void;
}

export function useMessageInitialization({
  fetchedMessages,
  chatId,
  selectedModelId,
  hasMessages,
  initialPromptFromRoute,
  initialPromptSent,
  wasAborted,
  attachedFiles,
  isLoading,
  isStreaming,
  setMessages,
  setInitialPrompt,
}: UseMessageInitializationParams) {
  const hasMessagesRef = useRef(hasMessages);
  hasMessagesRef.current = hasMessages;

  useEffect(() => {
    if (!fetchedMessages || !chatId || isLoading || wasAborted) return;

    // Skip reprocessing during streaming to preserve attachment references and prevent image flashing
    if (isStreaming && hasMessagesRef.current) return;

    const formattedMessages = fetchedMessages.map((msg: Message) => {
      const processedAttachments = msg.attachments?.map((attachment) => {
        const fileType = detectFileType(
          attachment.filename || '',
          attachment.file_type === 'image' ? 'image/jpeg' : undefined,
        );

        return { ...attachment, file_type: fileType };
      });

      return {
        id: msg.id || crypto.randomUUID(),
        chat_id: msg.chat_id,
        content_text: msg.content_text ?? '',
        content_render: msg.content_render ?? { events: [] },
        last_seq: msg.last_seq ?? 0,
        active_stream_id: msg.active_stream_id ?? null,
        stream_status: msg.stream_status ?? (msg.role === 'assistant' ? 'completed' : undefined),
        role: msg.role,
        is_bot: msg.role === 'assistant',
        attachments: processedAttachments,
        created_at: msg.created_at,
        model_id: msg.model_id,
      };
    });

    const latestKnownSeq = formattedMessages.reduce((maxSeq, message) => {
      const seq = Number(message.last_seq ?? 0);
      return Number.isFinite(seq) && seq > maxSeq ? seq : maxSeq;
    }, 0);
    if (latestKnownSeq > 0) {
      chatStorage.setEventId(chatId, String(latestKnownSeq));
    }

    if (
      initialPromptFromRoute &&
      formattedMessages.length === 0 &&
      !initialPromptSent &&
      selectedModelId
    ) {
      const initialMessage = createInitialMessage(
        initialPromptFromRoute,
        attachedFiles,
        selectedModelId,
        chatId,
      );
      setMessages([initialMessage]);
      setInitialPrompt(initialPromptFromRoute);
    } else if (formattedMessages.length > 0) {
      setMessages(formattedMessages);
    }
  }, [
    fetchedMessages,
    chatId,
    selectedModelId,
    initialPromptSent,
    wasAborted,
    initialPromptFromRoute,
    attachedFiles,
    isLoading,
    isStreaming,
    setMessages,
    setInitialPrompt,
  ]);
}
