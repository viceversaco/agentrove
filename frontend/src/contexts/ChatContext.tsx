import { type ReactNode, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { CustomAgent, CustomCommand, CustomPrompt } from '@/types/user.types';
import { ChatContext } from './ChatContextDefinition';

const EMPTY_FILES: FileStructure[] = [];
const EMPTY_AGENTS: CustomAgent[] = [];
const EMPTY_COMMANDS: CustomCommand[] = [];
const EMPTY_PROMPTS: CustomPrompt[] = [];

interface ChatProviderProps {
  chatId?: string;
  sandboxId?: string;
  fileStructure?: FileStructure[];
  customAgents?: CustomAgent[];
  customSlashCommands?: CustomCommand[];
  customPrompts?: CustomPrompt[];
  children: ReactNode;
}

export function ChatProvider({
  chatId,
  sandboxId,
  fileStructure = EMPTY_FILES,
  customAgents = EMPTY_AGENTS,
  customSlashCommands = EMPTY_COMMANDS,
  customPrompts = EMPTY_PROMPTS,
  children,
}: ChatProviderProps) {
  const value = useMemo(
    () => ({
      chatId,
      sandboxId,
      fileStructure,
      customAgents,
      customSlashCommands,
      customPrompts,
    }),
    [chatId, sandboxId, fileStructure, customAgents, customSlashCommands, customPrompts],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
