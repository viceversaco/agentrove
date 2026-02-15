import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { useLayoutSidebar } from '@/components/layout/layoutState';
import { Input } from '@/components/chat/message-input/Input';
import { Button } from '@/components/ui/primitives/Button';
import { Globe, BarChart3, Code2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { useAuthStore } from '@/store/authStore';
import { useInfiniteChatsQuery, useCreateChatMutation } from '@/hooks/queries/useChatQueries';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { mergeAgents } from '@/utils/settings';
import { ChatProvider } from '@/contexts/ChatContext';

interface ExamplePrompt {
  icon: LucideIcon;
  label: string;
  prompt: string;
}

const useExamplePrompts = () =>
  useMemo<ExamplePrompt[]>(
    () => [
      {
        icon: Globe,
        label: 'Browse the web',
        prompt: 'Go to Amazon and find the best laptops under $1000',
      },
      {
        icon: BarChart3,
        label: 'Analyze data',
        prompt: 'Analyze this Excel file and create visualizations',
      },
      {
        icon: Code2,
        label: 'Build an app',
        prompt: 'Build a full-stack app with FastAPI and React',
      },
    ],
    [],
  );

export function LandingPage() {
  const navigate = useNavigate();
  const attachedFiles = useChatStore((state) => state.attachedFiles);
  const setAttachedFiles = useChatStore((state) => state.setAttachedFiles);
  const setCurrentChat = useChatStore((state) => state.setCurrentChat);
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

  const chats = useMemo(() => {
    if (!isAuthenticated || !chatsData?.pages?.length) return [];
    return chatsData.pages.flatMap((page) => page.items);
  }, [chatsData?.pages, isAuthenticated]);

  const createChat = useCreateChatMutation();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const examplePrompts = useExamplePrompts();

  const { data: settings } = useSettingsQuery({
    enabled: isAuthenticated,
  });

  const allAgents = useMemo(() => {
    return mergeAgents(settings?.custom_agents);
  }, [settings?.custom_agents]);

  const enabledSlashCommands = useMemo(() => {
    return settings?.custom_slash_commands?.filter((cmd) => cmd.enabled) || [];
  }, [settings?.custom_slash_commands]);

  const customPrompts = useMemo(() => {
    return settings?.custom_prompts || [];
  }, [settings?.custom_prompts]);

  useEffect(() => {
    setCurrentChat(null);
  }, [setCurrentChat]);

  const handleFileAttach = useCallback(
    (files: File[]) => {
      setAttachedFiles(files);
    },
    [setAttachedFiles],
  );

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

      setIsLoading(true);
      try {
        const title = trimmedPrompt.replace(/\s+/g, ' ').slice(0, 80) || 'New Chat';
        const newChat = await createChat.mutateAsync({ title, model_id: selectedModelId });
        setMessage('');
        navigate(`/chat/${newChat.id}`, { state: { initialPrompt: trimmedPrompt } });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to create chat');
      } finally {
        setIsLoading(false);
      }
    },
    [createChat, isAuthenticated, isLoading, message, navigate, selectedModelId],
  );

  const handleChatSelect = useCallback(
    (chatId: string) => {
      navigate(`/chat/${chatId}`);
    },
    [navigate],
  );

  const handleExampleClick = useCallback((prompt: string) => {
    setMessage(prompt);
  }, []);

  const sidebarContent = useMemo(() => {
    if (!isAuthenticated) return null;

    return (
      <Sidebar
        chats={chats}
        selectedChatId={null}
        onChatSelect={handleChatSelect}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    );
  }, [chats, fetchNextPage, handleChatSelect, hasNextPage, isAuthenticated, isFetchingNextPage]);

  useLayoutSidebar(sidebarContent);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex flex-1">
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="w-full max-w-2xl">
            <div className="mb-6 text-center">
              <p className="text-sm font-medium text-text-secondary dark:text-text-dark-secondary">
                What would you like to build?
              </p>
            </div>
            <ChatProvider
              customAgents={allAgents}
              customSlashCommands={enabledSlashCommands}
              customPrompts={customPrompts}
            >
              <Input
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
              />
            </ChatProvider>
            <div className="mt-5 flex justify-center gap-2 px-4 sm:px-6">
              {examplePrompts.map((example, index) => {
                const Icon = example.icon;
                return (
                  <Button
                    key={example.prompt}
                    onClick={() => handleExampleClick(example.prompt)}
                    variant="unstyled"
                    className="group flex animate-fade-in items-center gap-2 rounded-xl border border-border px-3.5 py-2.5 text-left opacity-0 transition-all duration-200 hover:border-border-hover hover:bg-surface-secondary dark:border-border-dark dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-tertiary"
                    style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'forwards' }}
                  >
                    <Icon className="h-3.5 w-3.5 flex-shrink-0 text-text-quaternary transition-colors duration-200 group-hover:text-text-secondary dark:text-text-dark-quaternary dark:group-hover:text-text-dark-tertiary" />
                    <span className="text-xs text-text-tertiary transition-colors duration-200 group-hover:text-text-primary dark:text-text-dark-tertiary dark:group-hover:text-text-dark-secondary">
                      {example.label}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
