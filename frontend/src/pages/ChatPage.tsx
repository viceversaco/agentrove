import { useEffect, useMemo, useCallback, useRef, ReactNode, lazy, Suspense } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Sidebar } from '@/components/layout/Sidebar';
import { useLayoutSidebar } from '@/components/layout/layoutState';
import { useUIStore } from '@/store/uiStore';
import { useChatStore } from '@/store/chatStore';
import { SplitViewContainer } from '@/components/ui/SplitViewContainer';
import { CommandMenu } from '@/components/ui/CommandMenu';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { Spinner } from '@/components/ui/primitives/Spinner';
import type { ViewType } from '@/types/ui.types';
import { Chat as ChatComponent } from '@/components/chat/chat-window/Chat';
import { ChatSessionOrchestrator } from '@/components/chat/chat-window/ChatSessionOrchestrator';
import { useEditorState } from '@/hooks/useEditorState';
import { useChatData } from '@/hooks/useChatData';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import {
  useWorkspacesQuery,
  useWorkspaceResourcesQuery,
} from '@/hooks/queries/useWorkspaceQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { mergeAgents, mergeByName, mergeCommands } from '@/utils/settings';
import { findFileByToolPath } from '@/utils/file';
import { ChatProvider } from '@/contexts/ChatContext';

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
const DiffView = lazy(() =>
  import('@/components/views/DiffView').then((m) => ({ default: m.DiffView })),
);
const TerminalContainer = lazy(() =>
  import('@/components/sandbox/terminal/Container').then((m) => ({ default: m.Container })),
);

const viewLoadingFallback = (
  <div className="flex h-full w-full items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
    <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
  </div>
);

export function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();

  useCommandMenu();

  const { currentView, secondaryView } = useUIStore(
    useShallow((state) => ({
      currentView: state.currentView,
      secondaryView: state.secondaryView,
    })),
  );

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

  const { data: workspacesData } = useWorkspacesQuery();
  const workspaces = workspacesData?.items ?? [];

  const { data: settings } = useSettingsQuery();

  const { data: workspaceResources } = useWorkspaceResourcesQuery(currentChat?.workspace_id);

  const allAgents = useMemo(
    () => mergeByName(mergeAgents(settings?.custom_agents), workspaceResources?.agents ?? []),
    [settings?.custom_agents, workspaceResources?.agents],
  );

  const enabledSlashCommands = useMemo(
    () =>
      mergeCommands(
        settings?.custom_slash_commands,
        settings?.custom_skills,
        workspaceResources?.commands,
        workspaceResources?.skills,
      ),
    [
      settings?.custom_slash_commands,
      settings?.custom_skills,
      workspaceResources?.commands,
      workspaceResources?.skills,
    ],
  );

  const customPrompts = useMemo(() => settings?.custom_prompts ?? [], [settings?.custom_prompts]);

  const { selectedFile, setSelectedFile, isRefreshing, handleRefresh, handleFileSelect } =
    useEditorState(refetchFilesMetadata);

  useEffect(() => {
    useChatStore.getState().setCurrentChat(currentChat || null);
  }, [currentChat]);

  useEffect(() => {
    setSelectedFile(null);
    useUIStore.getState().setCurrentView('agent');
    useUIStore.setState({ pendingFilePath: null });
  }, [chatId, setSelectedFile]);

  const pendingFilePath = useUIStore((s) => s.pendingFilePath);

  useEffect(() => {
    if (!pendingFilePath || fileStructure.length === 0) return;

    const file = findFileByToolPath(fileStructure, pendingFilePath);
    setSelectedFile(file ?? { path: pendingFilePath, type: 'file', content: '' });
    useUIStore.setState({ pendingFilePath: null });
  }, [pendingFilePath, setSelectedFile, fileStructure]);

  const handleChatSelect = useCallback(
    (selectedChatId: string) => {
      navigate(`/chat/${selectedChatId}`);
    },
    [navigate],
  );

  const sidebarContent = useMemo(() => {
    if (currentView !== 'agent') return null;
    return (
      <Sidebar
        chats={chats}
        workspaces={workspaces}
        selectedChatId={chatId || null}
        onChatSelect={handleChatSelect}
        hasNextPage={chatsQueryMeta.hasNextPage}
        fetchNextPage={chatsQueryMeta.fetchNextPage}
        isFetchingNextPage={chatsQueryMeta.isFetchingNextPage}
      />
    );
  }, [
    currentView,
    chats,
    workspaces,
    chatId,
    chatsQueryMeta.fetchNextPage,
    handleChatSelect,
    chatsQueryMeta.hasNextPage,
    chatsQueryMeta.isFetchingNextPage,
  ]);

  useLayoutSidebar(sidebarContent);

  const renderNonTerminalView = useCallback(
    (view: ViewType): ReactNode => {
      switch (view) {
        case 'agent':
          return <ChatComponent />;
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
        case 'diff':
          return (
            <Suspense fallback={viewLoadingFallback}>
              <DiffView sandboxId={currentChat?.sandbox_id} />
            </Suspense>
          );
        default:
          return null;
      }
    },
    [
      chatId,
      currentChat,
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
              <TerminalContainer
                sandboxId={currentChat?.sandbox_id}
                chatId={currentChat?.id}
                isVisible={isTerminal}
                panelKey={slot}
              />
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
      <ChatSessionOrchestrator
        chatId={chatId}
        currentChat={currentChat}
        fetchedMessages={fetchedMessages}
        hasFetchedMessages={hasFetchedMessages}
        messagesQuery={messagesQuery}
        refetchFilesMetadata={refetchFilesMetadata}
      >
        <div className="relative flex h-full">
          <div className="flex h-full flex-1 overflow-hidden bg-surface text-text-primary dark:bg-surface-dark dark:text-text-dark-primary">
            <SplitViewContainer renderView={renderView} />
          </div>
          <CommandMenu />
        </div>
      </ChatSessionOrchestrator>
    </ChatProvider>
  );
}
