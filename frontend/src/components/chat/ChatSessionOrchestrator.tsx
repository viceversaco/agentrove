import { useEffect, useMemo, useCallback, type ReactNode } from 'react';
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
  selectedModelId: string;
  children: ReactNode;
}

export function ChatSessionOrchestrator({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  messagesQuery,
  refetchFilesMetadata,
  selectedModelId,
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

  const { selectModel } = useModelSelection();

  const {
    initialPrompt,
    setInitialPrompt,
    initialPromptSent,
    setInitialPromptSent,
    initialPromptFromRoute,
  } = useInitialPrompt();

  const { contextUsage, updateContextUsage } = useContextUsageState(chatId, currentChat);

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

  const {
    messages,
    sendMessage,
    isLoading,
    isStreaming,
    error,
    wasAborted,
    setWasAborted,
    setMessages,
  } = streamingState;

  useMessageInitialization({
    fetchedMessages,
    chatId,
    selectedModelId,
    hasMessages: messages.length > 0,
    initialPromptFromRoute,
    initialPromptSent,
    wasAborted,
    attachedFiles,
    isLoading,
    isStreaming,
    setMessages,
    setInitialPrompt,
  });

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
      const userMessage = messages[0];
      sendMessage(initialPrompt, chatId, userMessage, attachedFiles);
      setInitialPromptSent(true);
      setAttachedFiles([]);
    }
  }, [
    initialPrompt,
    messages,
    messages.length,
    isLoading,
    isStreaming,
    sendMessage,
    chatId,
    initialPromptSent,
    error,
    setAttachedFiles,
    messagesQuery.isLoading,
    hasFetchedMessages,
    attachedFiles,
    setInitialPromptSent,
  ]);

  useEffect(() => {
    setInitialPromptSent(false);
  }, [chatId, setInitialPromptSent]);

  const handleRestoreSuccess = useCallback(() => {
    setWasAborted(false);
    messagesQuery.refetch();
    if (currentChat?.sandbox_id) {
      refetchFilesMetadata();
    }
  }, [setWasAborted, messagesQuery, currentChat?.sandbox_id, refetchFilesMetadata]);

  const chatSessionState = useMemo<ChatSessionState>(
    () => ({
      messages,
      isLoading,
      isStreaming,
      isInitialLoading: messagesQuery.isLoading,
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
      onRestoreSuccess: handleRestoreSuccess,
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
      handleRestoreSuccess,
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
