import { useMemo } from 'react';
import {
  useInfiniteChatsQuery,
  useInfiniteMessagesQuery,
  useChatQuery,
} from '@/hooks/queries/useChatQueries';
import type { Chat as ChatSummary, Message } from '@/types';

interface UseChatDataResult {
  chats: ChatSummary[];
  currentChat: ChatSummary | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  chatsQueryMeta: {
    fetchNextPage: ReturnType<typeof useInfiniteChatsQuery>['fetchNextPage'];
    hasNextPage: ReturnType<typeof useInfiniteChatsQuery>['hasNextPage'];
    isFetchingNextPage: ReturnType<typeof useInfiniteChatsQuery>['isFetchingNextPage'];
  };
  messagesQuery: ReturnType<typeof useInfiniteMessagesQuery>;
}

export function useChatData(chatId: string | undefined): UseChatDataResult {
  const chatsQuery = useInfiniteChatsQuery();
  const messagesQuery = useInfiniteMessagesQuery(chatId || '');

  const chats = useMemo(
    () => chatsQuery.data?.pages?.flatMap((page) => page.items) ?? [],
    [chatsQuery.data?.pages],
  );
  const fetchedMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return [];
    // Backend returns pages in DESC order (newest first). To display chronologically:
    // 1. Reverse pages array so oldest page comes first
    // 2. Reverse items within each page so oldest message comes first
    // Result: [oldest...newest] for proper chat display order
    const reversedPages = [...messagesQuery.data.pages].reverse();
    const allMessages = reversedPages.flatMap((page) => [...page.items].reverse());
    const seen = new Set<string>();
    return allMessages.filter((msg) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }, [messagesQuery.data?.pages]);

  const currentChatFromList = useMemo(
    () => chats.find((chat) => chat.id === chatId),
    [chats, chatId],
  );

  const singleChatQuery = useChatQuery(chatId || '', {
    enabled: !!chatId && !currentChatFromList,
  });

  const currentChat = currentChatFromList ?? singleChatQuery.data;

  return {
    chats,
    currentChat,
    fetchedMessages,
    hasFetchedMessages: fetchedMessages.length > 0,
    chatsQueryMeta: {
      fetchNextPage: chatsQuery.fetchNextPage,
      hasNextPage: chatsQuery.hasNextPage,
      isFetchingNextPage: chatsQuery.isFetchingNextPage,
    },
    messagesQuery,
  };
}
