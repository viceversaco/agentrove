import { useEffect, useMemo, useCallback, useRef, ReactNode, lazy, Suspense } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Sidebar, useLayoutSidebar } from '@/components/layout';
import { useUIStore, useChatStore } from '@/store';
import { ViewSwitcher } from '@/components/ui/ViewSwitcher';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer';
import { Spinner } from '@/components/ui/primitives/Spinner';
import type { ViewType } from '@/types/ui.types';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { useQueryClient } from '@tanstack/react-query';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { usePermissionRequest } from '@/hooks/usePermissionRequest';
import { useInitialPrompt } from '@/hooks/useInitialPrompt';
import { useEditorState } from '@/hooks/useEditorState';
import { useMessageInitialization } from '@/hooks/useMessageInitialization';
import { useChatData } from '@/hooks/useChatData';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useContextUsageState } from '@/hooks/useContextUsageState';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { mergeAgents } from '@/utils/settings';
import { ChatProvider } from '@/contexts/ChatContext';
import { ChatSessionProvider } from '@/contexts/ChatSessionContext';
import { ChatInputMessageProvider } from '@/contexts/ChatInputMessageContext';
import type { ChatSessionState, ChatSessionActions } from '@/contexts/ChatSessionContextDefinition';

const Editor = lazy(() =>
  import('@/components/editor/editor-core/Editor').then((m) => ({ default: m.Editor })),
);
const IDEView = lazy(() =>
  import('@/components/views/IDEView').then((m) => ({ default: m.IDEView })),
);
const SecretsView = lazy(() =>
  import('@/components/views/SecretsView').then((m) => ({ default: m.SecretsView })),
);
const WebPreviewView = lazy(() =>
  import('@/components/views/WebPreviewView').then((m) => ({ default: m.WebPreviewView })),
);
const MobilePreviewView = lazy(() =>
  import('@/components/views/MobilePreviewView').then((m) => ({ default: m.MobilePreviewView })),
);
const BrowserView = lazy(() =>
  import('@/components/views/BrowserView').then((m) => ({ default: m.BrowserView })),
);
const TerminalView = lazy(() =>
  import('@/components/views/TerminalView').then((m) => ({ default: m.TerminalView })),
);

const viewLoadingFallback = (
  <div className="flex h-full w-full items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
    <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
  </div>
);

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { attachedFiles, setAttachedFiles, setCurrentChat } = useChatStore(
    useShallow((state) => ({
      attachedFiles: state.attachedFiles,
      setAttachedFiles: state.setAttachedFiles,
      setCurrentChat: state.setCurrentChat,
    })),
  );

  const { selectedModelId, selectModel } = useModelSelection();

  const { permissionMode, thinkingMode, currentView, secondaryView, setCurrentView } = useUIStore(
    useShallow((state) => ({
      permissionMode: state.permissionMode,
      thinkingMode: state.thinkingMode,
      currentView: state.currentView,
      secondaryView: state.secondaryView,
      setCurrentView: state.setCurrentView,
    })),
  );

  const {
    initialPrompt,
    setInitialPrompt,
    initialPromptSent,
    setInitialPromptSent,
    initialPromptFromRoute,
  } = useInitialPrompt();

  const { chats, currentChat, fetchedMessages, hasFetchedMessages, chatsQueryMeta, messagesQuery } =
    useChatData(chatId);

  const { fileStructure, isFileMetadataLoading, refetchFilesMetadata } = useSandboxFiles(
    currentChat,
    chatId,
  );

  const prevViewsRef = useRef<{
    current: ViewType | null;
    secondary: ViewType | null;
    sandboxId: string | null;
  }>({
    current: null,
    secondary: null,
    sandboxId: null,
  });

  useEffect(() => {
    if (!currentChat?.sandbox_id) return;

    const prev = prevViewsRef.current;
    const switchedToEditorPrimary = currentView === 'editor' && prev.current !== 'editor';
    const switchedToEditorSecondary = secondaryView === 'editor' && prev.secondary !== 'editor';
    const isEditorActive = currentView === 'editor' || secondaryView === 'editor';
    const switchedSandbox = prev.sandboxId !== currentChat.sandbox_id;

    if (
      switchedToEditorPrimary ||
      switchedToEditorSecondary ||
      (isEditorActive && switchedSandbox)
    ) {
      refetchFilesMetadata();
    }

    prevViewsRef.current = {
      current: currentView,
      secondary: secondaryView,
      sandboxId: currentChat.sandbox_id,
    };
  }, [currentView, secondaryView, currentChat?.sandbox_id, refetchFilesMetadata]);

  const { contextUsage, updateContextUsage } = useContextUsageState(chatId, currentChat);

  const { data: settings } = useSettingsQuery();

  const allAgents = useMemo(() => mergeAgents(settings?.custom_agents), [settings?.custom_agents]);

  const enabledSlashCommands = useMemo(() => {
    return settings?.custom_slash_commands?.filter((cmd) => cmd.enabled) || [];
  }, [settings?.custom_slash_commands]);

  const customPrompts = useMemo(() => {
    return settings?.custom_prompts || [];
  }, [settings?.custom_prompts]);

  const { selectedFile, setSelectedFile, isRefreshing, handleRefresh, handleFileSelect } =
    useEditorState(refetchFilesMetadata);

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
    setCurrentChat(currentChat || null);
  }, [currentChat, setCurrentChat]);

  useEffect(() => {
    setInitialPromptSent(false);
    setSelectedFile(null);
    setCurrentView('agent');
  }, [chatId, setInitialPromptSent, setSelectedFile, setCurrentView]);

  const handleChatSelect = useCallback(
    (selectedChatId: string) => {
      navigate(`/chat/${selectedChatId}`);
    },
    [navigate],
  );

  const handleRestoreSuccess = useCallback(() => {
    setWasAborted(false);
    messagesQuery.refetch();
    if (currentChat?.sandbox_id) {
      refetchFilesMetadata();
    }
  }, [setWasAborted, messagesQuery, currentChat?.sandbox_id, refetchFilesMetadata]);

  const sidebarContent = useMemo(() => {
    if (currentView !== 'agent') return null;
    return (
      <Sidebar
        chats={chats}
        selectedChatId={chatId || null}
        onChatSelect={handleChatSelect}
        hasNextPage={chatsQueryMeta.hasNextPage}
        fetchNextPage={chatsQueryMeta.fetchNextPage}
        isFetchingNextPage={chatsQueryMeta.isFetchingNextPage}
        hasActivityBar={true}
      />
    );
  }, [
    currentView,
    chats,
    chatId,
    chatsQueryMeta.fetchNextPage,
    handleChatSelect,
    chatsQueryMeta.hasNextPage,
    chatsQueryMeta.isFetchingNextPage,
  ]);

  useLayoutSidebar(sidebarContent);

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

  const renderNonTerminalView = useCallback(
    (view: ViewType): ReactNode => {
      switch (view) {
        case 'agent':
          return (
            <ChatSessionProvider state={chatSessionState} actions={chatSessionActions}>
              <ChatInputMessageProvider
                inputMessage={streamingState.inputMessage}
                setInputMessage={streamingState.setInputMessage}
              >
                <ChatComponent />
              </ChatInputMessageProvider>
            </ChatSessionProvider>
          );
        case 'editor':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <Editor
                files={fileStructure}
                isExpanded={true}
                selectedFile={selectedFile}
                onFileSelect={handleFileSelect}
                chatId={chatId}
                currentChat={currentChat}
                isSandboxSyncing={isFileMetadataLoading}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
              />
            </Suspense>
          );
        case 'ide':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <IDEView sandboxId={currentChat?.sandbox_id} isActive={true} />
            </Suspense>
          );
        case 'secrets':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <SecretsView chatId={chatId} sandboxId={currentChat?.sandbox_id} />
            </Suspense>
          );
        case 'webPreview':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <WebPreviewView sandboxId={currentChat?.sandbox_id} isActive={true} />
            </Suspense>
          );
        case 'mobilePreview':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <MobilePreviewView sandboxId={currentChat?.sandbox_id} />
            </Suspense>
          );
        case 'browser':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <BrowserView sandboxId={currentChat?.sandbox_id} isActive={true} />
            </Suspense>
          );
        default:
          return null;
      }
    },
    [
      chatSessionState,
      chatSessionActions,
      streamingState.inputMessage,
      streamingState.setInputMessage,
      currentChat,
      chatId,
      fileStructure,
      selectedFile,
      handleFileSelect,
      isFileMetadataLoading,
      handleRefresh,
      isRefreshing,
    ],
  );

  const renderView = useCallback(
    (view: ViewType, slot: 'single' | 'primary' | 'secondary'): ReactNode => {
      const isTerminal = view === 'terminal';
      return (
        <div className="relative flex h-full w-full">
          <div className={isTerminal ? 'flex h-full w-full' : 'hidden'}>
            <Suspense fallback={viewLoadingFallback}>
              <TerminalView currentChat={currentChat} isVisible={isTerminal} panelKey={slot} />
            </Suspense>
          </div>
          <div className={isTerminal ? 'hidden' : 'flex h-full w-full'}>
            {renderNonTerminalView(view)}
          </div>
        </div>
      );
    },
    [currentChat, renderNonTerminalView],
  );

  if (!chatId) return <Navigate to="/" />;

  return (
    <ChatProvider
      chatId={chatId}
      sandboxId={currentChat?.sandbox_id}
      fileStructure={fileStructure}
      customAgents={allAgents}
      customSlashCommands={enabledSlashCommands}
      customPrompts={customPrompts}
    >
      <div className="relative flex h-full">
        <ViewSwitcher />
        <div className="flex h-full flex-1 overflow-hidden bg-surface pl-12 text-text-primary dark:bg-surface-dark dark:text-text-dark-primary">
          <SplitViewContainer renderView={renderView} />
        </div>
      </div>
    </ChatProvider>
  );
}
