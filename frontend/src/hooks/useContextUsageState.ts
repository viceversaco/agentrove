import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContextUsageQuery } from '@/hooks/queries/useChatQueries';
import type { Chat, ContextUsage } from '@/types/chat.types';
import { CONTEXT_WINDOW_TOKENS } from '@/config/constants';

interface ContextUsageState {
  tokensUsed: number;
  contextWindow: number;
}

interface UseContextUsageStateResult {
  contextUsage: ContextUsageState;
  updateContextUsage: (data: ContextUsage, chatId?: string) => void;
}

export function useContextUsageState(
  chatId: string | undefined,
  currentChat: Chat | undefined,
  modelContextWindow: number | null | undefined,
): UseContextUsageStateResult {
  const effectiveContextWindow = modelContextWindow ?? CONTEXT_WINDOW_TOKENS;
  const [tokensUsed, setTokensUsed] = useState(0);
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const currentChatIdRef = useRef<string | undefined>(chatId);

  useEffect(() => {
    const chatIdChanged = prevChatIdRef.current !== chatId;
    prevChatIdRef.current = chatId;
    currentChatIdRef.current = chatId;

    if (!chatId) {
      setTokensUsed(0);
      return;
    }

    const hasMatchingChatUsage =
      currentChat?.id === chatId && currentChat.context_token_usage !== undefined;

    if (chatIdChanged && !hasMatchingChatUsage) {
      setTokensUsed(0);
    }

    if (hasMatchingChatUsage) {
      setTokensUsed(currentChat.context_token_usage);
    }
  }, [chatId, currentChat?.context_token_usage, currentChat?.id]);

  const { data: contextUsageData } = useContextUsageQuery(chatId || '', { enabled: !!chatId });

  useEffect(() => {
    if (!chatId || !contextUsageData) return;
    setTokensUsed(contextUsageData.tokens_used ?? 0);
  }, [chatId, contextUsageData]);

  const updateContextUsage = useCallback((data: ContextUsage, incomingChatId?: string) => {
    if (incomingChatId && incomingChatId !== currentChatIdRef.current) {
      return;
    }
    setTokensUsed(data.tokens_used ?? 0);
  }, []);

  const contextUsage = useMemo<ContextUsageState>(
    () => ({ tokensUsed, contextWindow: effectiveContextWindow }),
    [tokensUsed, effectiveContextWindow],
  );

  return { contextUsage, updateContextUsage };
}
