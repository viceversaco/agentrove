import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { useLayoutSidebar } from '@/components/layout/layoutState';
import { Input as ChatInput } from '@/components/chat/message-input/Input';
import { WorkspaceSelector } from '@/components/chat/WorkspaceSelector';
import { useChatStore } from '@/store/chatStore';
import { useModelStore } from '@/store/modelStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { useInfiniteChatsQuery, useCreateChatMutation } from '@/hooks/queries/useChatQueries';
import { useWorkspacesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { mergeAgents, mergeCommands } from '@/utils/settings';
import { ChatProvider } from '@/contexts/ChatContext';

const EXAMPLE_PROMPTS = [
  'Build a REST API with authentication',
  'Find and fix bugs in my codebase',
  'Refactor this project to use TypeScript',
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const attachedFiles = useChatStore((state) => state.attachedFiles);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { selectedModelId, selectModel } = useModelSelection({ enabled: isAuthenticated });

  const {
    data: chatsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteChatsQuery({
    enabled: isAuthenticated,
  });

  const { data: workspacesData } = useWorkspacesQuery({ enabled: isAuthenticated });
  const workspaces = workspacesData?.items ?? [];

  const chats = useMemo(() => {
    if (!isAuthenticated || !chatsData?.pages?.length) return [];
    return chatsData.pages.flatMap((page) => page.items);
  }, [chatsData?.pages, isAuthenticated]);

  const chatCountByWorkspace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chat of chats) {
      counts.set(chat.workspace_id, (counts.get(chat.workspace_id) ?? 0) + 1);
    }
    return counts;
  }, [chats]);

  const createChat = useCreateChatMutation();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const initialWorkspaceId = (location.state as { workspaceId?: string })?.workspaceId ?? null;
  const consumedWorkspaceRef = useRef<string | null>(null);

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialWorkspaceId &&
      initialWorkspaceId !== consumedWorkspaceRef.current &&
      workspaces.some((ws) => ws.id === initialWorkspaceId)
    ) {
      consumedWorkspaceRef.current = initialWorkspaceId;
      setSelectedWorkspaceId(initialWorkspaceId);
    }
  }, [initialWorkspaceId, workspaces]);

  useEffect(() => {
    if (
      selectedWorkspaceId &&
      workspaces.length &&
      !workspaces.some((ws) => ws.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(null);
    }
  }, [workspaces, selectedWorkspaceId]);

  const { data: settings } = useSettingsQuery({
    enabled: isAuthenticated,
  });

  const allAgents = useMemo(() => mergeAgents(settings?.custom_agents), [settings?.custom_agents]);

  const enabledSlashCommands = useMemo(
    () => mergeCommands(settings?.custom_slash_commands, settings?.custom_skills),
    [settings?.custom_slash_commands, settings?.custom_skills],
  );

  const customPrompts = useMemo(() => settings?.custom_prompts ?? [], [settings?.custom_prompts]);

  useEffect(() => {
    useChatStore.getState().setCurrentChat(null);
  }, []);

  const handleFileAttach = useCallback((files: File[]) => {
    useChatStore.getState().setAttachedFiles(files);
  }, []);

  const handleNewChat = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedPrompt = message.trim();
      if (!trimmedPrompt || isLoading) return;

      if (!isAuthenticated) {
        navigate('/signup');
        return;
      }

      if (!selectedModelId?.trim()) {
        toast.error('Please select an AI model');
        return;
      }

      if (!selectedWorkspaceId) {
        toast.error('Please select a workspace');
        return;
      }

      setIsLoading(true);
      try {
        const title = trimmedPrompt.replace(/\s+/g, ' ').slice(0, 80) || 'New Chat';
        const newChat = await createChat.mutateAsync({
          title,
          model_id: selectedModelId,
          workspace_id: selectedWorkspaceId,
        });
        useModelStore.getState().selectModel(newChat.id, selectedModelId);
        useChatSettingsStore.getState().initChatFromDefaults(newChat.id);
        setMessage('');
        navigate(`/chat/${newChat.id}`, { state: { initialPrompt: trimmedPrompt } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create chat');
      } finally {
        setIsLoading(false);
      }
    },
    [
      createChat,
      isAuthenticated,
      isLoading,
      message,
      navigate,
      selectedModelId,
      selectedWorkspaceId,
    ],
  );

  const handleChatSelect = useCallback(
    (chatId: string) => {
      navigate(`/chat/${chatId}`);
    },
    [navigate],
  );

  const sidebarContent = useMemo(() => {
    if (!isAuthenticated) return null;

    return (
      <Sidebar
        chats={chats}
        workspaces={workspaces}
        selectedChatId={null}
        onChatSelect={handleChatSelect}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    );
  }, [
    chats,
    workspaces,
    fetchNextPage,
    handleChatSelect,
    hasNextPage,
    isAuthenticated,
    isFetchingNextPage,
  ]);

  useLayoutSidebar(sidebarContent);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1">
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="w-full max-w-2xl">
            <WorkspaceSelector
              selectedWorkspaceId={selectedWorkspaceId}
              onWorkspaceChange={setSelectedWorkspaceId}
              enabled={isAuthenticated}
              chatCountByWorkspace={chatCountByWorkspace}
            />

            <ChatProvider
              customAgents={allAgents}
              customSlashCommands={enabledSlashCommands}
              customPrompts={customPrompts}
            >
              <ChatInput
                message={message}
                setMessage={setMessage}
                onSubmit={handleNewChat}
                onAttach={handleFileAttach}
                attachedFiles={attachedFiles}
                isLoading={isLoading}
                showLoadingSpinner={true}
                selectedModelId={selectedModelId}
                onModelChange={selectModel}
                showTip={false}
                placeholder="Ask Agentrove to build, fix bugs, explore"
              />
            </ChatProvider>

            <div className="mt-4 flex flex-wrap justify-center gap-2 px-4 sm:px-6">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setMessage(prompt)}
                  className="rounded-lg border border-border/50 px-3 py-2 text-2xs text-text-tertiary transition-colors duration-200 hover:border-border-hover hover:bg-surface-hover hover:text-text-primary dark:border-border-dark/50 dark:text-text-dark-tertiary dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
