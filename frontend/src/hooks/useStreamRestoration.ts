import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import type { Chat } from '@/types/chat.types';
import type { StreamMetadata } from '@/types/stream.types';
import { chatService } from '@/services/chatService';

interface UseStreamRestorationOptions {
  chats: Chat[] | undefined;
  isLoading: boolean;
  enabled?: boolean;
}

export function useStreamRestoration({
  chats,
  isLoading,
  enabled = true,
}: UseStreamRestorationOptions) {
  const hasRestoredRef = useRef(false);
  const addStreamMetadata = useStreamStore((state) => state.addStreamMetadata);

  useEffect(() => {
    if (!enabled || hasRestoredRef.current || isLoading || !chats || chats.length === 0) {
      return;
    }

    const restoreStreamMetadata = async () => {
      const chatsToCheck = chats.slice(0, 20);

      const checkPromises = chatsToCheck.map(async (chat) => {
        try {
          if (!chat || !chat.id) {
            return;
          }

          const status = await chatService.checkChatStatus(chat.id);

          if (status?.has_active_task) {
            const messageId = status.message_id;
            if (!messageId) {
              return;
            }

            const metadata: StreamMetadata = {
              chatId: chat.id,
              messageId,
              startTime: Date.now(),
            };

            addStreamMetadata(metadata);
          }
        } catch (error) {
          logger.error('Failed to check chat status', 'useStreamRestoration', {
            chatId: chat.id,
            error,
          });
        }
      });

      await Promise.allSettled(checkPromises);
      hasRestoredRef.current = true;
    };

    restoreStreamMetadata().catch((error) => {
      logger.error('Stream restoration failed', 'useStreamRestoration', error);
    });
  }, [chats, isLoading, enabled, addStreamMetadata]);

  return { hasRestored: hasRestoredRef.current };
}
