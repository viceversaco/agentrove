import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { chatService } from '@/services/chatService';
import { chatStorage } from '@/utils/storage';
import type { Message } from '@/types/chat.types';
import type { StreamState } from '@/types/stream.types';

interface UseStreamReconnectParams {
  chatId: string | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  isInitialLoading: boolean;
  streamState: StreamState;
  currentMessageId: string | null;
  wasAborted: boolean;
  selectedModelId: string | null | undefined;
  setStreamState: Dispatch<SetStateAction<StreamState>>;
  setCurrentMessageId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  addMessageToCache: (message: Message) => void;
  updateMessageInCache: (messageId: string, updater: (msg: Message) => Message) => void;
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
}

// Handles reconnecting to active streams when returning to a chat.
// Checks if server has an active task and replays the stream from where it left off.
export function useStreamReconnect({
  chatId,
  fetchedMessages,
  hasFetchedMessages,
  isInitialLoading,
  streamState,
  currentMessageId,
  wasAborted,
  selectedModelId,
  setStreamState,
  setCurrentMessageId,
  setMessages,
  addMessageToCache,
  updateMessageInCache,
  replayStream,
}: UseStreamReconnectParams): void {
  useEffect(() => {
    if (!chatId || isInitialLoading || !hasFetchedMessages) return;

    const checkActiveTask = async () => {
      try {
        const status = await chatService.checkChatStatus(chatId);
        if (status?.has_active_task && streamState === 'idle' && !currentMessageId && !wasAborted) {
          let targetMessageId = status.message_id;

          if (!targetMessageId) {
            const latestAssistantMessage = [...fetchedMessages]
              .reverse()
              .find((msg) => msg.role === 'assistant');
            targetMessageId = latestAssistantMessage?.id;
          }

          if (targetMessageId) {
            setStreamState('streaming');
            setCurrentMessageId(targetMessageId);

            const messageExists = fetchedMessages.some((msg) => msg.id === targetMessageId);
            const existingMessage = fetchedMessages.find((msg) => msg.id === targetMessageId);
            const previousSnapshot = existingMessage
              ? {
                  content_text: existingMessage.content_text,
                  content_render: existingMessage.content_render,
                  last_seq: existingMessage.last_seq,
                  active_stream_id: existingMessage.active_stream_id ?? null,
                }
              : null;

            const reconnectSeq = status.last_seq ?? existingMessage?.last_seq ?? 0;
            const storedSeqRaw = chatStorage.getEventId(chatId);
            const storedSeq = storedSeqRaw ? Number(storedSeqRaw) : Number.NaN;
            const normalizedStoredSeq = Number.isFinite(storedSeq) && storedSeq > 0 ? storedSeq : 0;
            const normalizedReconnectSeq = reconnectSeq > 0 ? reconnectSeq : 0;
            // If the active assistant message is absent locally, start replay from 0 so
            // we rebuild the full message instead of resuming from a truncated cursor.
            const replayAfterSeq = messageExists
              ? Math.max(normalizedStoredSeq, normalizedReconnectSeq)
              : 0;
            if (replayAfterSeq > 0) {
              chatStorage.setEventId(chatId, String(replayAfterSeq));
            } else {
              chatStorage.removeEventId(chatId);
            }

            if (!messageExists) {
              const placeholderMessage: Message = {
                id: targetMessageId,
                chat_id: chatId,
                role: 'assistant',
                content_text: '',
                content_render: { events: [] },
                last_seq: status.last_seq ?? 0,
                active_stream_id: status.stream_id ?? null,
                stream_status: 'in_progress',
                created_at: new Date().toISOString(),
                model_id: selectedModelId || '',
                is_bot: true,
              };
              addMessageToCache(placeholderMessage);
              setMessages((prev) => [...prev, placeholderMessage]);
            }

            try {
              await replayStream(targetMessageId, replayAfterSeq);
            } catch (replayError) {
              logger.error('Stream reconnect failed', 'useStreamReconnect', replayError);
              if (previousSnapshot) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === targetMessageId ? { ...msg, ...previousSnapshot } : msg,
                  ),
                );
                updateMessageInCache(targetMessageId, (msg) => ({
                  ...msg,
                  ...previousSnapshot,
                }));
              }
              setStreamState('idle');
              setCurrentMessageId(null);
            }
          }
        }
      } catch (checkError) {
        logger.error('Active task check failed', 'useStreamReconnect', checkError);
      }
    };

    const timeoutId = setTimeout(checkActiveTask, 100);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    chatId,
    currentMessageId,
    fetchedMessages,
    hasFetchedMessages,
    isInitialLoading,
    replayStream,
    streamState,
    updateMessageInCache,
    wasAborted,
    addMessageToCache,
    selectedModelId,
    setStreamState,
    setCurrentMessageId,
    setMessages,
  ]);
}
