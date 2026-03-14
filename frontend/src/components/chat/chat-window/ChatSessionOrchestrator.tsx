import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { ChatSessionProvider } from '@/contexts/ChatSessionContext';
import { ChatInputMessageProvider } from '@/contexts/ChatInputMessageContext';
import type { ChatSessionState, ChatSessionActions } from '@/contexts/ChatSessionContextDefinition';
import { useChatStore } from '@/store/chatStore';
import { useUIStore } from '@/store/uiStore';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { usePermissionRequest } from '@/hooks/usePermissionRequest';
import { useInitialPrompt } from '@/hooks/useInitialPrompt';
import { useContextUsageState } from '@/hooks/useContextUsageState';
import { useMessageInitialization } from '@/hooks/useMessageInitialization';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import type { Chat, Message } from '@/types/chat.types';
import type { useInfiniteMessagesQuery } from '@/hooks/queries/useChatQueries';

interface ChatSessionOrchestratorProps {
  chatId: string;
  currentChat: Chat | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  messagesQuery: ReturnType<typeof useInfiniteMessagesQuery>;
  refetchFilesMetadata: () => Promise<unknown>;
  children: ReactNode;
}

export function ChatSessionOrchestrator({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  messagesQuery,
  refetchFilesMetadata,
  children,
}: ChatSessionOrchestratorProps) {
  const queryClient = useQueryClient();

  const { attachedFiles, setAttachedFiles } = useChatStore(
    useShallow((state) => ({
      attachedFiles: state.attachedFiles,
      setAttachedFiles: state.setAttachedFiles,
    })),
  );

  const { permissionMode, thinkingMode } = useUIStore(
    useShallow((state) => ({
      permissionMode: state.permissionMode,
      thinkingMode: state.thinkingMode,
    })),
  );

  const lastAssistantModelId = useMemo((): string | null | undefined => {
    if (messagesQuery.isLoading) return null;
    for (let i = fetchedMessages.length - 1; i >= 0; i--) {
      if (fetchedMessages[i].role === 'assistant' && fetchedMessages[i].model_id) {
        return fetchedMessages[i].model_id;
      }
    }
    return undefined;
  }, [fetchedMessages, messagesQuery.isLoading]);

  const { selectedModelId, selectedModel, selectModel } = useModelSelection({
    chatId,
    initialModelId: lastAssistantModelId,
  });

  const {
    initialPrompt,
    setInitialPrompt,
    initialPromptSent,
    setInitialPromptSent,
    initialPromptFromRoute,
  } = useInitialPrompt();

  const { contextUsage, updateContextUsage } = useContextUsageState(
    chatId,
    currentChat,
    selectedModel?.context_window,
  );

  const {
    pendingRequest,
    isLoading: isPermissionLoading,
    error: permissionError,
    handlePermissionRequest,
    handleApprove,
    handleReject,
  } = usePermissionRequest(chatId);

  const streamingState = useChatStreaming({
    chatId,
    currentChat,
    fetchedMessages,
    hasFetchedMessages,
    isInitialLoading: messagesQuery.isLoading,
    queryClient,
    refetchFilesMetadata,
    onContextUsageUpdate: updateContextUsage,
    selectedModelId,
    permissionMode,
    thinkingMode,
    onPermissionRequest: handlePermissionRequest,
  });

  const { messages, sendMessage, isLoading, isStreaming, error, wasAborted, setMessages } =
    streamingState;

  useMessageInitialization({
    fetchedMessages,
    chatId,
    selectedModelId,
    initialPromptFromRoute,
    initialPromptSent,
    wasAborted,
    attachedFiles,
    isLoading,
    isStreaming,
    setMessages,
    setInitialPrompt,
  });

  const initialPromptActionsRef = useRef({
    sendMessage,
    chatId,
    attachedFiles,
    setInitialPromptSent,
    setAttachedFiles,
  });
  initialPromptActionsRef.current = {
    sendMessage,
    chatId,
    attachedFiles,
    setInitialPromptSent,
    setAttachedFiles,
  };

  useEffect(() => {
    if (
      initialPrompt &&
      messages.length === 1 &&
      !isLoading &&
      !isStreaming &&
      !initialPromptSent &&
      !error &&
      !messagesQuery.isLoading &&
      !hasFetchedMessages
    ) {
      const {
        sendMessage: send,
        chatId: cid,
        attachedFiles: files,
        setInitialPromptSent: setSent,
        setAttachedFiles: setFiles,
      } = initialPromptActionsRef.current;
      const userMessage = messages[0];
      send(initialPrompt, cid, userMessage, files);
      setSent(true);
      setFiles([]);
    }
  }, [
    initialPrompt,
    messages,
    isLoading,
    isStreaming,
    initialPromptSent,
    error,
    messagesQuery.isLoading,
    hasFetchedMessages,
  ]);

  useEffect(() => {
    setInitialPromptSent(false);
  }, [chatId, setInitialPromptSent]);

  const chatSessionState = useMemo<ChatSessionState>(
    () => ({
      messages,
      isLoading,
      isStreaming,
      isInitialLoading: messagesQuery.isLoading || (hasFetchedMessages && messages.length === 0),
      error,
      copiedMessageId: streamingState.copiedMessageId,
      pendingUserMessageId: streamingState.pendingUserMessageId ?? null,
      attachedFiles: streamingState.inputFiles ?? null,
      selectedModelId,
      contextUsage,
      hasNextPage: messagesQuery.hasNextPage ?? false,
      isFetchingNextPage: messagesQuery.isFetchingNextPage ?? false,
      pendingPermissionRequest: pendingRequest ?? null,
      isPermissionLoading,
      permissionError: permissionError ?? null,
    }),
    [
      messages,
      streamingState.copiedMessageId,
      streamingState.pendingUserMessageId,
      streamingState.inputFiles,
      isLoading,
      isStreaming,
      messagesQuery.isLoading,
      hasFetchedMessages,
      messagesQuery.hasNextPage,
      messagesQuery.isFetchingNextPage,
      error,
      selectedModelId,
      contextUsage,
      pendingRequest,
      isPermissionLoading,
      permissionError,
    ],
  );

  const chatSessionActions = useMemo<ChatSessionActions>(
    () => ({
      onSubmit: streamingState.handleMessageSend,
      onStopStream: streamingState.handleStop,
      onCopy: streamingState.handleCopy,
      onAttach: streamingState.setInputFiles,
      onModelChange: selectModel,
      onDismissError: streamingState.handleDismissError,
      fetchNextPage: messagesQuery.fetchNextPage,
      onPermissionApprove: handleApprove,
      onPermissionReject: handleReject,
    }),
    [
      streamingState.handleMessageSend,
      streamingState.handleStop,
      streamingState.handleCopy,
      streamingState.setInputFiles,
      streamingState.handleDismissError,
      selectModel,
      messagesQuery.fetchNextPage,
      handleApprove,
      handleReject,
    ],
  );

  return (
    <ChatSessionProvider state={chatSessionState} actions={chatSessionActions}>
      <ChatInputMessageProvider
        inputMessage={streamingState.inputMessage}
        setInputMessage={streamingState.setInputMessage}
      >
        {children}
      </ChatInputMessageProvider>
    </ChatSessionProvider>
  );
}
