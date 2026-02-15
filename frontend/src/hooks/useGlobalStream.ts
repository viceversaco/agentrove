import { useCallback, useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import { streamService } from '@/services/streamService';
import { chatService } from '@/services/chatService';

interface UseGlobalStreamOptions {
  onValidationComplete?: () => void;
}

export function useGlobalStream(options?: UseGlobalStreamOptions) {
  const removeStreamMetadata = useStreamStore((state) => state.removeStreamMetadata);
  const hasValidatedRef = useRef(false);

  useEffect(() => {
    if (hasValidatedRef.current) return;
    hasValidatedRef.current = true;

    const validateStreams = async () => {
      const metadata = useStreamStore.getState().activeStreamMetadata;

      if (metadata.length === 0) return;

      const validationPromises = metadata.map(async (streamMeta) => {
        try {
          const status = await chatService.checkChatStatus(streamMeta.chatId);

          if (!status?.has_active_task) {
            removeStreamMetadata(streamMeta.chatId);
          }
        } catch (error) {
          logger.error('Stream validation failed', 'useGlobalStream', error);
          removeStreamMetadata(streamMeta.chatId);
        }
      });

      await Promise.allSettled(validationPromises);
      options?.onValidationComplete?.();
    };

    const timeoutId = setTimeout(validateStreams, 500);

    return () => clearTimeout(timeoutId);
  }, [removeStreamMetadata, options]);

  const stopAllStreams = useCallback(async () => {
    await streamService.stopAllStreams();
  }, []);

  return {
    stopAllStreams,
  };
}
