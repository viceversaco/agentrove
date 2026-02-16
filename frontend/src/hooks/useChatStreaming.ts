import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { QueryClient } from '@tanstack/react-query';
import { useStreamStore } from '@/store/streamStore';
import type { Chat, ContextUsage, Message, PermissionRequest } from '@/types/chat.types';
import type { StreamState } from '@/types/stream.types';
import { cleanupExpiredPdfBlobs, storePdfBlobUrl } from '@/hooks/usePdfBlobCache';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useInputState } from '@/hooks/useInputState';
import { useClipboard } from '@/hooks/useClipboard';
import { useStreamCallbacks } from '@/hooks/useStreamCallbacks';
import { useStreamReconnect } from '@/hooks/useStreamReconnect';
import { streamService } from '@/services/streamService';

export { useStreamRestoration } from './useStreamRestoration';
export { useGlobalStream } from './useGlobalStream';

interface UseChatStreamingParams {
  chatId: string | undefined;
  currentChat: Chat | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  isInitialLoading: boolean;
  queryClient: QueryClient;
  refetchFilesMetadata: () => Promise<unknown>;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  selectedModelId: string | null | undefined;
  permissionMode: 'plan' | 'ask' | 'auto';
  thinkingMode: string | null | undefined;
  onPermissionRequest?: (request: PermissionRequest) => void;
}

interface UseChatStreamingResult {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  pendingUserMessageId: string | null;
  inputMessage: string;
  setInputMessage: Dispatch<SetStateAction<string>>;
  inputFiles: File[];
  setInputFiles: Dispatch<SetStateAction<File[]>>;
  copiedMessageId: string | null;
  handleCopy: (content: string, id: string) => Promise<void>;
  handleMessageSend: (event: FormEvent) => Promise<void>;
  handleStop: () => void;
  sendMessage: (
    prompt: string,
    chatIdOverride?: string,
    userMessage?: Message,
    filesToSend?: File[],
    fileCountBeforeOverride?: number,
  ) => Promise<void>;
  isLoading: boolean;
  isStreaming: boolean;
  error: Error | null;
  handleDismissError: () => void;
  wasAborted: boolean;
  setWasAborted: Dispatch<SetStateAction<boolean>>;
  currentMessageId: string | null;
  streamState: StreamState;
}

function findActiveStreamForChat(chatId: string) {
  const activeStreams = useStreamStore.getState().activeStreams;
  for (const stream of activeStreams.values()) {
    if (stream.chatId === chatId && stream.isActive) {
      return stream;
    }
  }
  return undefined;
}

export function useChatStreaming({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  isInitialLoading,
  queryClient,
  refetchFilesMetadata,
  onContextUsageUpdate,
  selectedModelId,
  permissionMode,
  thinkingMode,
  onPermissionRequest,
}: UseChatStreamingParams): UseChatStreamingResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [wasAborted, setWasAborted] = useState(false);
  const [pendingUserMessageId, setPendingUserMessageIdState] = useState<string | null>(null);
  const pendingStopRef = useRef<Set<string>>(new Set());
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const lastConnectedStreamRef = useRef<string | null>(null);
  const currentMessageIdRef = useRef<string | null>(null);
  const sendMessageRef = useRef<
    | ((
        prompt: string,
        chatIdOverride?: string,
        userMessage?: Message,
        filesToSend?: File[],
      ) => Promise<void>)
    | null
  >(null);

  const isLoading = streamState === 'loading';
  const isStreaming = streamState === 'streaming';

  const { inputMessage, setInputMessage, inputFiles, setInputFiles, clearInput } = useInputState({
    chatId,
  });
  const { copiedMessageId, handleCopy } = useClipboard({ chatId });

  const {
    onEnvelope,
    onComplete,
    onError,
    onQueueProcess,
    startStream,
    replayStream,
    stopStream,
    updateMessageInCache,
    addMessageToCache,
    setPendingUserMessageId,
  } = useStreamCallbacks({
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
    onPendingUserMessageIdChange: setPendingUserMessageIdState,
  });

  useEffect(() => {
    if (!chatId) return;

    const checkAndUpdateCallbacks = () => {
      const existingStream = findActiveStreamForChat(chatId);

      if (existingStream && lastConnectedStreamRef.current !== existingStream.id) {
        lastConnectedStreamRef.current = existingStream.id;
        useStreamStore.getState().updateStreamCallbacks(chatId, existingStream.messageId, {
          onEnvelope,
          onComplete,
          onError,
          onQueueProcess,
        });
      } else if (!existingStream) {
        lastConnectedStreamRef.current = null;
      }
    };

    checkAndUpdateCallbacks();

    const unsubscribe = useStreamStore.subscribe(checkAndUpdateCallbacks);
    return () => unsubscribe();
  }, [chatId, onEnvelope, onComplete, onError, onQueueProcess]);

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      setStreamState('idle');
      setCurrentMessageId(null);
      setError(null);
      setWasAborted(false);
      setPendingUserMessageIdState(null);
      prevChatIdRef.current = chatId;
    }

    if (!chatId) return;

    const syncStreamState = () => {
      const activeStreamForChat = findActiveStreamForChat(chatId);

      if (activeStreamForChat) {
        const isPendingStop = pendingStopRef.current.has(activeStreamForChat.messageId);

        if (!isPendingStop) {
          setStreamState('streaming');
          setCurrentMessageId(activeStreamForChat.messageId);
          setWasAborted(false);
        }
      } else {
        setStreamState((prev) => {
          if (prev === 'streaming') {
            setCurrentMessageId(null);
            pendingStopRef.current.clear();
            return 'idle';
          }
          return prev;
        });
      }
    };

    syncStreamState();

    const unsubscribe = useStreamStore.subscribe(syncStreamState);
    return () => unsubscribe();
  }, [chatId]);

  const { sendMessage, handleMessageSend: handleMessageSendAction } = useMessageActions({
    chatId,
    selectedModelId,
    permissionMode,
    thinkingMode,
    setStreamState,
    setCurrentMessageId,
    setError,
    setWasAborted,
    setMessages,
    addMessageToCache,
    startStream,
    storeBlobUrl: storePdfBlobUrl,
    setPendingUserMessageId,
    isLoading,
    isStreaming,
  });

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  useStreamReconnect({
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
  });

  const handleStopStream = useCallback(
    async (messageId?: string) => {
      const pendingIds = new Set<string>();
      if (messageId) {
        pendingIds.add(messageId);
      } else if (chatId) {
        const activeStreams = useStreamStore.getState().activeStreams;
        activeStreams.forEach((stream) => {
          if (stream.chatId === chatId && stream.isActive) {
            pendingIds.add(stream.messageId);
          }
        });
      }
      pendingStopRef.current = pendingIds;
      setStreamState('idle');
      setCurrentMessageId(null);
      setWasAborted(true);
      setPendingUserMessageId(null);

      try {
        if (messageId) {
          await stopStream(messageId);
        } else {
          await streamService.stopAllStreams();
        }
      } catch (err) {
        logger.error('Stream stop request failed', 'useChatStreaming', err);
        pendingStopRef.current.clear();
      }
    },
    [chatId, setPendingUserMessageId, stopStream],
  );

  const handleDismissError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    setMessages([]);
  }, [chatId]);

  useEffect(() => {
    currentMessageIdRef.current = currentMessageId;
  }, [currentMessageId]);

  const handleStop = useCallback(() => {
    void handleStopStream(currentMessageIdRef.current || undefined);
    clearInput();
  }, [handleStopStream, clearInput]);

  useEffect(() => {
    cleanupExpiredPdfBlobs();
    const interval = setInterval(cleanupExpiredPdfBlobs, 1000 * 60 * 30);
    return () => clearInterval(interval);
  }, []);

  const handleMessageSend = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const result = await handleMessageSendAction(inputMessage, inputFiles);
      if (result?.success) {
        clearInput();
      }
    },
    [handleMessageSendAction, inputMessage, inputFiles, clearInput],
  );

  return {
    messages,
    setMessages,
    pendingUserMessageId,
    inputMessage,
    setInputMessage,
    inputFiles,
    setInputFiles,
    copiedMessageId,
    handleCopy,
    handleMessageSend,
    handleStop,
    sendMessage,
    isLoading,
    isStreaming,
    error,
    handleDismissError,
    wasAborted,
    setWasAborted,
    currentMessageId,
    streamState,
  };
}
