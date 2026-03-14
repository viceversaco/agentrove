import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions, InfiniteData } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import type { Chat, ContextUsage, CreateChatRequest } from '@/types/chat.types';
import type { PaginatedChats } from '@/types/api.types';
import { queryKeys } from './queryKeys';

const CHATS_PER_PAGE = 25;

export const useInfiniteChatsQuery = (options?: { perPage?: number; enabled?: boolean }) => {
  const perPage = options?.perPage ?? CHATS_PER_PAGE;

  return useInfiniteQuery({
    queryKey: [queryKeys.chats, 'infinite', perPage] as const,
    queryFn: async ({ pageParam }) => {
      const page = pageParam as number;
      return chatService.listChats({ page, per_page: perPage });
    },
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1;
      return nextPage <= lastPage.pages ? nextPage : undefined;
    },
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
    gcTime: 1000 * 60 * 1,
  });
};

export const useInfiniteMessagesQuery = (chatId: string, limit: number = 20) => {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(chatId),
    queryFn: async ({ pageParam }) => {
      return chatService.getMessages(chatId, {
        cursor: pageParam as string | undefined,
        limit,
      });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!chatId,
    gcTime: 1000 * 60 * 1,
  });
};

export const useChatQuery = (chatId: string, options?: Partial<UseQueryOptions<Chat>>) => {
  return useQuery({
    queryKey: queryKeys.chat(chatId),
    queryFn: () => chatService.getChat(chatId),
    enabled: !!chatId,
    ...options,
  });
};

export const useContextUsageQuery = (
  chatId: string,
  options?: Partial<UseQueryOptions<ContextUsage>>,
) => {
  return useQuery({
    queryKey: queryKeys.contextUsage(chatId),
    queryFn: () => chatService.getContextUsage(chatId),
    enabled: !!chatId,
    staleTime: 0,
    ...options,
  });
};

export const useCreateChatMutation = (
  options?: UseMutationOptions<Chat, Error, CreateChatRequest>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: CreateChatRequest) => chatService.createChat(data),
    onSuccess: async (newChat, variables, context, mutation) => {
      queryClient.setQueryData(queryKeys.chat(newChat.id), newChat);

      queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
        { queryKey: [queryKeys.chats, 'infinite'] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page, index) =>
              index === 0
                ? { ...page, items: [newChat, ...page.items], total: page.total + 1 }
                : page,
            ),
          };
        },
      );

      if (onSuccess) {
        await onSuccess(newChat, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useUpdateChatMutation = (
  options?: UseMutationOptions<Chat, Error, { chatId: string; updateData: { title?: string } }>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ chatId, updateData }) => chatService.updateChat(chatId, updateData),
    onSuccess: async (updatedChat, variables, context, mutation) => {
      queryClient.setQueryData(queryKeys.chat(updatedChat.id), updatedChat);

      queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
        { queryKey: [queryKeys.chats, 'infinite'] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              items: page.items.map((chat) => (chat.id === updatedChat.id ? updatedChat : chat)),
            })),
          };
        },
      );

      if (onSuccess) {
        await onSuccess(updatedChat, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const usePinChatMutation = (
  options?: UseMutationOptions<Chat, Error, { chatId: string; pinned: boolean }>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ chatId, pinned }) =>
      pinned ? chatService.pinChat(chatId) : chatService.unpinChat(chatId),
    onSuccess: async (updatedChat, variables, context, mutation) => {
      queryClient.setQueryData(queryKeys.chat(updatedChat.id), updatedChat);

      queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
        { queryKey: [queryKeys.chats, 'infinite'] },
        (oldData) => {
          if (!oldData) return oldData;

          const updatedPages = oldData.pages.map((page) => ({
            ...page,
            items: page.items.map((chat) => (chat.id === updatedChat.id ? updatedChat : chat)),
          }));

          const allChats = updatedPages.flatMap((page) => page.items);
          // TODO(perf): Replace [...arr].sort() with arr.toSorted() once tsconfig lib
          // is upgraded from ES2020 to ES2023+. Build target is esnext so runtime supports it.
          const sortedChats = [...allChats].sort((a, b) => {
            if (a.pinned_at && b.pinned_at) {
              return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
            }
            if (a.pinned_at && !b.pinned_at) return -1;
            if (!a.pinned_at && b.pinned_at) return 1;
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          });

          let chatIndex = 0;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => {
              const pageChats = sortedChats.slice(chatIndex, chatIndex + page.items.length);
              chatIndex += page.items.length;
              return { ...page, items: pageChats };
            }),
          };
        },
      );

      if (onSuccess) {
        await onSuccess(updatedChat, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useDeleteChatMutation = (options?: UseMutationOptions<void, Error, string>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (chatId: string) => chatService.deleteChat(chatId),
    onSuccess: async (data, chatId, context, mutation) => {
      queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
        { queryKey: [queryKeys.chats, 'infinite'] },
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              items: page.items.filter((chat) => chat.id !== chatId),
              total: Math.max(0, page.total - 1),
            })),
          };
        },
      );

      queryClient.removeQueries({ queryKey: queryKeys.chat(chatId) });
      queryClient.removeQueries({ queryKey: queryKeys.messages(chatId) });
      queryClient.removeQueries({ queryKey: queryKeys.contextUsage(chatId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      useMessageQueueStore.getState().cleanupChat(chatId);

      if (onSuccess) {
        await onSuccess(data, chatId, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useDeleteAllChatsMutation = (options?: UseMutationOptions<void, Error, void>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: () => chatService.deleteAllChats(),
    onSuccess: async (data, variables, context, mutation) => {
      queryClient.removeQueries({ queryKey: [queryKeys.chats] });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

interface EnhancePromptParams {
  prompt: string;
  modelId: string;
}

export const useEnhancePromptMutation = (
  options?: UseMutationOptions<string, Error, EnhancePromptParams>,
) => {
  return useMutation({
    mutationFn: ({ prompt, modelId }: EnhancePromptParams) =>
      chatService.enhancePrompt(prompt, modelId),
    ...options,
  });
};
