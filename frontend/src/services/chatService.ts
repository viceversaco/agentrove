import { apiClient, StreamResponse } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';
import { authService } from '@/services/authService';
import { validateRequired, validateId } from '@/utils/validation';
import { chatStorage } from '@/utils/storage';
import type {
  ChatRequest,
  Chat,
  CreateChatRequest,
  ContextUsage,
  ForkChatResponse,
} from '@/types/chat.types';
import type {
  PaginationParams,
  CursorPaginationParams,
  PaginatedChats,
  PaginatedMessages,
} from '@/types/api.types';
import { CONTEXT_WINDOW_TOKENS } from '@/config/constants';

async function createCompletion(
  request: ChatRequest,
  signal?: AbortSignal,
): Promise<StreamResponse> {
  validateRequired(request.prompt, 'Prompt');

  return serviceCall(
    async () => {
      const formData = new FormData();
      formData.append('prompt', request.prompt);

      if (request.chat_id) {
        formData.append('chat_id', request.chat_id);
      }
      if (request.model_id) {
        formData.append('model_id', request.model_id);
      }
      if (request.attached_files && request.attached_files.length > 0) {
        request.attached_files.forEach((file) => {
          formData.append('attached_files', file);
        });
      }
      if (request.thinking_mode) {
        formData.append('thinking_mode', request.thinking_mode);
      }
      if (request.selected_prompt_name) {
        formData.append('selected_prompt_name', request.selected_prompt_name);
      }
      formData.append('permission_mode', request.permission_mode);

      const taskResponse = await apiClient.postForm<{
        chat_id: string;
        message_id: string;
        last_seq?: number;
      }>('/chat/chat', formData, signal);

      const payload = ensureResponse(taskResponse, 'Failed to start chat completion');
      const eventSource = createEventSource(payload.chat_id, signal, payload.last_seq);

      return {
        source: eventSource,
        messageId: payload.message_id,
      };
    },
    { signal },
  );
}

async function checkChatStatus(chatId: string): Promise<{
  has_active_task: boolean;
  message_id?: string;
  stream_id?: string;
  last_seq?: number;
} | null> {
  return serviceCall(() => apiClient.get(`/chat/chats/${chatId}/status`));
}

async function reconnectToStream(
  chatId: string,
  messageId: string,
  signal?: AbortSignal,
  afterSeq?: number,
): Promise<{
  source: EventSource;
  messageId: string;
}> {
  const eventSource = createEventSource(chatId, signal, afterSeq);

  return {
    source: eventSource,
    messageId,
  };
}

async function stopStream(chatId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete(`/chat/chats/${chatId}/stream`);
  });
}

async function getMessages(
  chatId: string,
  pagination?: CursorPaginationParams,
): Promise<PaginatedMessages> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const params: Record<string, string | number> = {};
    if (pagination?.cursor) params.cursor = pagination.cursor;
    if (pagination?.limit) params.limit = pagination.limit;

    const queryString = buildQueryString(params);
    const endpoint = `/chat/chats/${chatId}/messages${queryString}`;

    const response = await apiClient.get<PaginatedMessages>(endpoint);
    return (
      response ?? {
        items: [],
        next_cursor: null,
        has_more: false,
      }
    );
  });
}

async function listChats(pagination?: PaginationParams): Promise<PaginatedChats> {
  return serviceCall(async () => {
    const queryString = buildQueryString(pagination as unknown as Record<string, number>);
    const endpoint = `/chat/chats${queryString}`;

    const response = await apiClient.get<PaginatedChats>(endpoint);
    return (
      response ?? {
        items: [],
        page: 1,
        per_page: 10,
        total: 0,
        pages: 0,
      }
    );
  });
}

async function getChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.get<Chat>(`/chat/chats/${chatId}`);
    return ensureResponse(response, 'Failed to fetch chat');
  });
}

async function createChat(data: CreateChatRequest): Promise<Chat> {
  return serviceCall(async () => {
    const response = await apiClient.post<Chat>('/chat/chats', data);
    return ensureResponse(response, 'Failed to create chat');
  });
}

async function updateChat(chatId: string, updateData: { title?: string }): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, updateData);
    return ensureResponse(response, 'Failed to update chat');
  });
}

async function deleteChat(chatId: string): Promise<void> {
  validateId(chatId, 'Chat ID');

  await serviceCall(async () => {
    await apiClient.delete(`/chat/chats/${chatId}`);
  });
}

async function deleteAllChats(): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete('/chat/chats/all');
  });
}

async function restoreToCheckpoint(chatId: string, messageId: string): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(messageId, 'Message ID');

  await serviceCall(async () => {
    await apiClient.post(`/chat/chats/${chatId}/restore`, {
      message_id: messageId,
    });
  });
}

async function forkChat(chatId: string, messageId: string): Promise<ForkChatResponse> {
  validateId(chatId, 'Chat ID');
  validateId(messageId, 'Message ID');

  return serviceCall(async () => {
    const response = await apiClient.post<ForkChatResponse>(`/chat/chats/${chatId}/fork`, {
      message_id: messageId,
    });
    return ensureResponse(response, 'Failed to fork chat');
  });
}

async function getContextUsage(chatId: string): Promise<ContextUsage> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.get<ContextUsage>(`/chat/chats/${chatId}/context-usage`);
    return (
      response ?? {
        tokens_used: 0,
        context_window: CONTEXT_WINDOW_TOKENS,
        percentage: 0,
      }
    );
  });
}

function normalizePositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function createEventSource(
  chatId: string,
  signal?: AbortSignal,
  baselineSeq?: number,
): EventSource {
  const token = authService.getToken();
  if (!token) {
    throw new Error('Authentication token required');
  }

  const storedSeq = normalizePositiveInt(chatStorage.getEventId(chatId));
  const providedSeq = normalizePositiveInt(baselineSeq);
  const afterSeq = Math.max(storedSeq, providedSeq);
  if (afterSeq > storedSeq) {
    chatStorage.setEventId(chatId, String(afterSeq));
  }

  const baseUrl = `${apiClient.getBaseUrl()}/chat/chats/${chatId}/stream`;

  const params = new URLSearchParams();
  params.append('token', token);
  params.append('after_seq', String(afterSeq));

  const url = `${baseUrl}?${params.toString()}`;
  const eventSource = new EventSource(url);

  if (signal) {
    const abortHandler = () => {
      signal.removeEventListener('abort', abortHandler);
      eventSource.close();
    };

    signal.addEventListener('abort', abortHandler);
    if (signal.aborted) {
      abortHandler();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
  }

  return eventSource;
}

async function pinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, { pinned: true });
    return ensureResponse(response, 'Failed to pin chat');
  });
}

async function unpinChat(chatId: string): Promise<Chat> {
  validateId(chatId, 'Chat ID');

  return serviceCall(async () => {
    const response = await apiClient.patch<Chat>(`/chat/chats/${chatId}`, { pinned: false });
    return ensureResponse(response, 'Failed to unpin chat');
  });
}

async function enhancePrompt(prompt: string, modelId: string): Promise<string> {
  validateRequired(prompt, 'Prompt');
  validateRequired(modelId, 'Model ID');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('model_id', modelId);

    const response = await apiClient.postForm<{ enhanced_prompt: string }>(
      '/chat/enhance-prompt',
      formData,
    );

    return ensureResponse(response, 'Failed to enhance prompt').enhanced_prompt;
  });
}

export const chatService = {
  createCompletion,
  checkChatStatus,
  reconnectToStream,
  stopStream,
  getMessages,
  listChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  deleteAllChats,
  restoreToCheckpoint,
  forkChat,
  getContextUsage,
  enhancePrompt,
  pinChat,
  unpinChat,
};
