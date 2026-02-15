import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { StreamingContentAccumulator, type ContentRenderSnapshot } from '@/utils/stream';
import { playNotificationSound } from '@/utils/audio';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import type {
  AssistantStreamEvent,
  Chat,
  ContextUsage,
  Message,
  PermissionRequest,
} from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';
import type { QueueProcessingData, StreamEnvelope, StreamState } from '@/types/stream.types';
import { useMessageCache } from '@/hooks/useMessageCache';
import { streamService } from '@/services/streamService';
import type { StreamOptions } from '@/services/streamService';
import { useUIStore } from '@/store/uiStore';

const STREAM_FLUSH_INTERVAL_MS = 200;

function createEmptyRenderSnapshot(): ContentRenderSnapshot {
  return { events: [] };
}

interface UseStreamCallbacksParams {
  messages: Message[];
  chatId: string | undefined;
  currentChat: Chat | undefined;
  queryClient: QueryClient;
  refetchFilesMetadata: () => Promise<unknown>;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setStreamState: Dispatch<SetStateAction<StreamState>>;
  setCurrentMessageId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<Error | null>>;
  pendingStopRef: React.MutableRefObject<Set<string>>;
  onPendingUserMessageIdChange?: (id: string | null) => void;
}

interface UseStreamCallbacksResult {
  onEnvelope: (envelope: StreamEnvelope) => void;
  onComplete: (
    messageId?: string,
    streamId?: string,
    terminalKind?: 'complete' | 'cancelled',
  ) => void;
  onError: (error: Error, messageId?: string, streamId?: string) => void;
  onQueueProcess: (data: QueueProcessingData) => void;
  startStream: (request: StreamOptions['request']) => Promise<string>;
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
  stopStream: (messageId: string) => Promise<void>;
  updateMessageInCache: ReturnType<typeof useMessageCache>['updateMessageInCache'];
  addMessageToCache: ReturnType<typeof useMessageCache>['addMessageToCache'];
  removeMessagesFromCache: ReturnType<typeof useMessageCache>['removeMessagesFromCache'];
  setPendingUserMessageId: (id: string | null) => void;
}

interface StreamSessionState {
  messageId: string;
  lastSeq: number;
}

function envelopeToRenderEvent(envelope: StreamEnvelope): AssistantStreamEvent | null {
  const payload = envelope.payload as Record<string, unknown>;

  switch (envelope.kind) {
    case 'assistant_text': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) return null;
      return { type: 'assistant_text', text };
    }
    case 'assistant_thinking': {
      const thinking = typeof payload.thinking === 'string' ? payload.thinking : '';
      if (!thinking) return null;
      return { type: 'assistant_thinking', thinking };
    }
    case 'tool_started':
    case 'tool_completed':
    case 'tool_failed': {
      if (!payload.tool || typeof payload.tool !== 'object') {
        return null;
      }
      return {
        type: envelope.kind,
        tool: payload.tool as ToolEventPayload,
      } as AssistantStreamEvent;
    }
    case 'prompt_suggestions': {
      const raw = payload.suggestions;
      if (!Array.isArray(raw)) return null;
      const suggestions = raw.filter((item): item is string => typeof item === 'string');
      if (suggestions.length === 0) return null;
      return { type: 'prompt_suggestions', suggestions };
    }
    case 'system':
      return { type: 'system', data: payload };
    case 'permission_request': {
      const request_id = typeof payload.request_id === 'string' ? payload.request_id : '';
      const tool_name = typeof payload.tool_name === 'string' ? payload.tool_name : '';
      const tool_input =
        payload.tool_input && typeof payload.tool_input === 'object'
          ? (payload.tool_input as Record<string, unknown>)
          : {};
      if (!request_id || !tool_name) return null;
      return { type: 'permission_request', request_id, tool_name, tool_input };
    }
    default:
      return null;
  }
}

export function useStreamCallbacks({
  messages,
  chatId,
  currentChat,
  queryClient,
  refetchFilesMetadata,
  onContextUsageUpdate,
  onPermissionRequest,
  setMessages,
  setStreamState,
  setCurrentMessageId,
  setError,
  pendingStopRef,
  onPendingUserMessageIdChange,
}: UseStreamCallbacksParams): UseStreamCallbacksResult {
  const optionsRef = useRef<{
    chatId: string;
    onEnvelope?: (envelope: StreamEnvelope) => void;
    onComplete?: (
      messageId?: string,
      streamId?: string,
      terminalKind?: 'complete' | 'cancelled',
    ) => void;
    onError?: (error: Error, messageId?: string, streamId?: string) => void;
    onQueueProcess?: (data: QueueProcessingData) => void;
  } | null>(null);

  const pendingUserMessageIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  const timerIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const accumulatorsRef = useRef<Map<string, StreamingContentAccumulator>>(new Map());
  const flushTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const streamSessionsRef = useRef<Map<string, StreamSessionState>>(new Map());

  const { updateMessageInCache, addMessageToCache, removeMessagesFromCache } = useMessageCache({
    chatId,
    queryClient,
  });
  const { data: settings } = useSettingsQuery();

  const clearStreamSession = useCallback((streamId: string | undefined) => {
    if (!streamId) return;

    const flushTimer = flushTimersRef.current.get(streamId);
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimersRef.current.delete(streamId);
    }

    accumulatorsRef.current.delete(streamId);
    streamSessionsRef.current.delete(streamId);
  }, []);

  const resolveStreamIdForMessage = useCallback((messageId?: string): string | undefined => {
    if (!messageId) return undefined;

    for (const [streamId, session] of streamSessionsRef.current.entries()) {
      if (session.messageId === messageId) {
        return streamId;
      }
    }

    return undefined;
  }, []);

  const applyProjection = useCallback(
    (streamId: string, { writeToCache }: { writeToCache: boolean }) => {
      const accumulator = accumulatorsRef.current.get(streamId);
      const session = streamSessionsRef.current.get(streamId);
      if (!accumulator || !session) return;

      const nextRender = accumulator.snapshot();
      const nextText = accumulator.getContentText();
      const nextSeq = session.lastSeq;
      const update = (message: Message): Message => ({
        ...message,
        content_text: nextText,
        content_render: nextRender,
        last_seq: nextSeq,
        active_stream_id: streamId,
      });

      setMessages((prevMessages) =>
        prevMessages.map((msg) => (msg.id === session.messageId ? update(msg) : msg)),
      );

      if (writeToCache) {
        updateMessageInCache(session.messageId, update);
      }
    },
    [setMessages, updateMessageInCache],
  );

  const scheduleProjection = useCallback(
    (streamId: string) => {
      if (flushTimersRef.current.has(streamId)) {
        return;
      }

      const timer = setTimeout(() => {
        flushTimersRef.current.delete(streamId);
        // Persist throttled snapshots to cache while streaming so switching chats/views
        // does not drop the currently accumulated in-memory stream content.
        applyProjection(streamId, { writeToCache: true });
      }, STREAM_FLUSH_INTERVAL_MS);

      flushTimersRef.current.set(streamId, timer);
    },
    [applyProjection],
  );

  const ensureAccumulator = useCallback(
    (streamId: string, messageId: string, seq: number): StreamingContentAccumulator => {
      const existing = accumulatorsRef.current.get(streamId);
      if (existing) {
        const existingSession = streamSessionsRef.current.get(streamId);
        if (existingSession) {
          existingSession.lastSeq = Math.max(existingSession.lastSeq, seq);
          existingSession.messageId = messageId;
        }
        return existing;
      }

      let seedEvents: AssistantStreamEvent[] = [];
      let seedText = '';
      const existingMessage = messagesRef.current.find((msg) => msg.id === messageId);
      if (existingMessage) {
        const maybeEvents = existingMessage.content_render?.events;
        seedEvents = Array.isArray(maybeEvents) ? maybeEvents : [];
        seedText = existingMessage.content_text ?? '';
      }

      const accumulator = new StreamingContentAccumulator(seedEvents, seedText);
      accumulatorsRef.current.set(streamId, accumulator);
      streamSessionsRef.current.set(streamId, {
        messageId,
        lastSeq: seq,
      });

      return accumulator;
    },
    [],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const flushTimers = flushTimersRef.current;
    const accumulators = accumulatorsRef.current;
    const streamSessions = streamSessionsRef.current;

    return () => {
      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];

      flushTimers.forEach((timer) => clearTimeout(timer));
      flushTimers.clear();

      accumulators.clear();
      streamSessions.clear();
    };
  }, []);

  const setPendingUserMessageId = useCallback(
    (id: string | null) => {
      pendingUserMessageIdRef.current = id;
      onPendingUserMessageIdChange?.(id);
    },
    [onPendingUserMessageIdChange],
  );

  const onEnvelope = useCallback(
    (envelope: StreamEnvelope) => {
      if (pendingStopRef.current.has(envelope.messageId)) {
        return;
      }

      if (pendingUserMessageIdRef.current) {
        setPendingUserMessageId(null);
      }

      if (envelope.kind === 'permission_request' && onPermissionRequest) {
        const payload = envelope.payload as Record<string, unknown>;
        const request_id = typeof payload.request_id === 'string' ? payload.request_id : undefined;
        const tool_name = typeof payload.tool_name === 'string' ? payload.tool_name : undefined;
        const tool_input =
          payload.tool_input && typeof payload.tool_input === 'object'
            ? (payload.tool_input as Record<string, unknown>)
            : undefined;

        if (request_id && tool_name && tool_input) {
          onPermissionRequest({
            request_id,
            tool_name,
            tool_input,
          });
        }
        return;
      }

      if (envelope.kind === 'system' && onContextUsageUpdate) {
        const payload = envelope.payload as Record<string, unknown>;
        const nestedData =
          payload.data && typeof payload.data === 'object'
            ? (payload.data as Record<string, unknown>)
            : undefined;
        const contextUsage =
          (payload.context_usage as ContextUsage | undefined) ??
          (nestedData?.context_usage as ContextUsage | undefined);
        if (contextUsage) {
          const eventChatId =
            typeof payload.chat_id === 'string'
              ? payload.chat_id
              : typeof nestedData?.chat_id === 'string'
                ? nestedData.chat_id
                : undefined;
          onContextUsageUpdate(contextUsage, eventChatId);
        }
        return;
      }

      if (envelope.kind === 'tool_completed') {
        const tool = (envelope.payload as { tool?: ToolEventPayload })?.tool;
        if (tool?.name === 'EnterPlanMode') {
          useUIStore.getState().setPermissionMode('plan');
        } else if (tool?.name === 'ExitPlanMode') {
          useUIStore.getState().setPermissionMode('auto');
        }
      }

      const renderEvent = envelopeToRenderEvent(envelope);
      if (!renderEvent) {
        return;
      }

      const accumulator = ensureAccumulator(envelope.streamId, envelope.messageId, envelope.seq);
      accumulator.push(renderEvent);

      const session = streamSessionsRef.current.get(envelope.streamId);
      if (session) {
        session.lastSeq = Math.max(session.lastSeq, envelope.seq);
        session.messageId = envelope.messageId;
      }

      scheduleProjection(envelope.streamId);
    },
    [
      ensureAccumulator,
      onContextUsageUpdate,
      onPermissionRequest,
      pendingStopRef,
      scheduleProjection,
      setPendingUserMessageId,
    ],
  );

  const onComplete = useCallback(
    (
      messageId?: string,
      streamId?: string,
      terminalKind: 'complete' | 'cancelled' = 'complete',
    ) => {
      const resolvedStreamId = streamId ?? resolveStreamIdForMessage(messageId);
      const isCancelled = terminalKind === 'cancelled';

      if (resolvedStreamId) {
        applyProjection(resolvedStreamId, { writeToCache: true });
      }

      if (messageId) {
        const finalizeMessage = (message: Message): Message => ({
          ...message,
          active_stream_id: null,
          stream_status: isCancelled ? 'interrupted' : 'completed',
        });
        setMessages((prev) =>
          prev.map((msg) => (msg.id === messageId ? finalizeMessage(msg) : msg)),
        );
        updateMessageInCache(messageId, finalizeMessage);
      }

      clearStreamSession(resolvedStreamId);
      setPendingUserMessageId(null);
      setStreamState('idle');
      setCurrentMessageId(null);

      if (!isCancelled && (settings?.notification_sound_enabled ?? true)) {
        playNotificationSound();
      }

      if (!isCancelled && chatId && currentChat?.sandbox_id) {
        refetchFilesMetadata().catch(() => {});
        queryClient.removeQueries({
          queryKey: ['sandbox', currentChat.sandbox_id, 'file-content'],
        });
      }

      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];

      timerIdsRef.current.push(
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: [queryKeys.auth.usage] });
        }, 2000),
      );

      if (chatId) {
        timerIdsRef.current.push(
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.contextUsage(chatId) });
          }, 6000),
        );
      }
    },
    [
      applyProjection,
      chatId,
      clearStreamSession,
      currentChat?.sandbox_id,
      queryClient,
      refetchFilesMetadata,
      resolveStreamIdForMessage,
      setCurrentMessageId,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
      settings?.notification_sound_enabled,
      updateMessageInCache,
    ],
  );

  const onError = useCallback(
    (streamError: Error, assistantMessageId?: string, streamId?: string) => {
      clearStreamSession(streamId ?? resolveStreamIdForMessage(assistantMessageId));

      setError(streamError);
      setStreamState('error');
      setCurrentMessageId(null);

      const userMessageId = pendingUserMessageIdRef.current;
      const messageIdsToRemove: string[] = [];

      if (userMessageId) {
        messageIdsToRemove.push(userMessageId);
      }
      if (assistantMessageId) {
        messageIdsToRemove.push(assistantMessageId);
      }

      if (messageIdsToRemove.length > 0) {
        const idsToRemove = new Set(messageIdsToRemove);
        setMessages((prev) => prev.filter((msg) => !idsToRemove.has(msg.id)));
        removeMessagesFromCache(messageIdsToRemove);
      }

      setPendingUserMessageId(null);
    },
    [
      clearStreamSession,
      removeMessagesFromCache,
      resolveStreamIdForMessage,
      setCurrentMessageId,
      setError,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
    ],
  );

  const onQueueProcess = useCallback(
    (data: QueueProcessingData) => {
      if (!chatId) return;

      // Queue continuation starts a new stream/message pair without terminal events
      // on the prior stream, so flush and drop stale per-stream session state.
      for (const [streamId, session] of Array.from(streamSessionsRef.current.entries())) {
        if (session.messageId === data.assistantMessageId) {
          continue;
        }
        applyProjection(streamId, { writeToCache: true });
        clearStreamSession(streamId);
      }

      const userMessage: Message = {
        id: data.userMessageId,
        chat_id: chatId,
        role: 'user',
        content_text: data.content,
        content_render: {
          events: [{ type: 'user_text', text: data.content }],
        },
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'completed',
        created_at: new Date().toISOString(),
        attachments: data.attachments || [],
        is_bot: false,
      };

      const assistantMessage: Message = {
        id: data.assistantMessageId,
        chat_id: chatId,
        role: 'assistant',
        content_text: '',
        content_render: createEmptyRenderSnapshot(),
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'in_progress',
        created_at: new Date().toISOString(),
        model_id: data.modelId,
        attachments: [],
        is_bot: true,
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      addMessageToCache(userMessage);
      addMessageToCache(assistantMessage);
      setCurrentMessageId(data.assistantMessageId);
    },
    [
      applyProjection,
      chatId,
      clearStreamSession,
      setMessages,
      addMessageToCache,
      setCurrentMessageId,
    ],
  );

  useEffect(() => {
    optionsRef.current = chatId
      ? { chatId, onEnvelope, onComplete, onError, onQueueProcess }
      : null;
  }, [chatId, onEnvelope, onComplete, onError, onQueueProcess]);

  const startStream = useCallback(async (request: StreamOptions['request']): Promise<string> => {
    const currentOptions = optionsRef.current;
    if (!currentOptions) {
      throw new Error('Stream options not available');
    }

    const streamOptions: StreamOptions = {
      chatId: currentOptions.chatId,
      request,
      onEnvelope: currentOptions.onEnvelope,
      onComplete: currentOptions.onComplete,
      onError: currentOptions.onError,
      onQueueProcess: currentOptions.onQueueProcess,
    };

    return streamService.startStream(streamOptions);
  }, []);

  const replayStream = useCallback(
    async (messageId: string, afterSeq?: number): Promise<string> => {
      const currentOptions = optionsRef.current;
      if (!currentOptions) {
        throw new Error('Stream options not available');
      }

      return streamService.replayStream({
        chatId: currentOptions.chatId,
        messageId,
        afterSeq,
        onEnvelope: currentOptions.onEnvelope,
        onComplete: currentOptions.onComplete,
        onError: currentOptions.onError,
        onQueueProcess: currentOptions.onQueueProcess,
      });
    },
    [],
  );

  const stopStream = useCallback(
    async (messageId: string) => {
      if (!chatId) return;
      await streamService.stopStreamByMessage(chatId, messageId);
    },
    [chatId],
  );

  return {
    onEnvelope,
    onComplete,
    onError,
    onQueueProcess,
    startStream,
    replayStream,
    stopStream,
    updateMessageInCache,
    addMessageToCache,
    removeMessagesFromCache,
    setPendingUserMessageId,
  };
}
