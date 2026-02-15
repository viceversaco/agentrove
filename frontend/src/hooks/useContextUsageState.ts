import { useCallback, useEffect, useRef, useState } from 'react';
import { useContextUsageQuery } from '@/hooks/queries/useChatQueries';
import type { Chat, ContextUsage } from '@/types';
import { CONTEXT_WINDOW_TOKENS } from '@/config/constants';

interface ContextUsageState {
  tokensUsed: number;
  contextWindow: number;
}

interface UseContextUsageStateResult {
  contextUsage: ContextUsageState;
  refetchContextUsage: () => Promise<unknown> | void;
  updateContextUsage: (data: ContextUsage, chatId?: string) => void;
}

export function useContextUsageState(
  chatId: string | undefined,
  currentChat: Chat | undefined,
): UseContextUsageStateResult {
  const [contextUsage, setContextUsage] = useState<ContextUsageState>({
    tokensUsed: 0,
    contextWindow: CONTEXT_WINDOW_TOKENS,
  });
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const currentChatIdRef = useRef<string | undefined>(chatId);

  useEffect(() => {
    const chatIdChanged = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;
    currentChatIdRef.current = chatId;

    if (!chatId) {
      setContextUsage({ tokensUsed: 0, contextWindow: CONTEXT_WINDOW_TOKENS });
      return;
    }

    const hasMatchingChatUsage =
      currentChat?.id === chatId && currentChat.context_token_usage !== undefined;

    if (chatIdChanged && !hasMatchingChatUsage) {
      setContextUsage({ tokensUsed: 0, contextWindow: CONTEXT_WINDOW_TOKENS });
    }

    if (hasMatchingChatUsage) {
      setContextUsage({
        tokensUsed: currentChat.context_token_usage,
        contextWindow: CONTEXT_WINDOW_TOKENS,
      });
    }
  }, [chatId, currentChat?.context_token_usage, currentChat?.id]);

  const { data: contextUsageData, refetch: refetchContextUsage } = useContextUsageQuery(
    chatId || '',
    { enabled: !!chatId },
  );

  useEffect(() => {
    if (!chatId || !contextUsageData) return;

    setContextUsage({
      tokensUsed: contextUsageData.tokens_used ?? 0,
      contextWindow: contextUsageData.context_window ?? CONTEXT_WINDOW_TOKENS,
    });
  }, [chatId, contextUsageData]);

  const updateContextUsage = useCallback((data: ContextUsage, incomingChatId?: string) => {
    if (incomingChatId && incomingChatId !== currentChatIdRef.current) {
      return;
    }

    setContextUsage({
      tokensUsed: data.tokens_used ?? 0,
      contextWindow: data.context_window ?? CONTEXT_WINDOW_TOKENS,
    });
  }, []);

  return { contextUsage, refetchContextUsage, updateContextUsage };
}
