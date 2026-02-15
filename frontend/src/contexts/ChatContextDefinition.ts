import { createContext } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { CustomAgent, CustomCommand, CustomPrompt } from '@/types/user.types';

export interface ChatContextValue {
  chatId?: string;
  sandboxId?: string;
  fileStructure: FileStructure[];
  customAgents: CustomAgent[];
  customSlashCommands: CustomCommand[];
  customPrompts: CustomPrompt[];
}

export const ChatContext = createContext<ChatContextValue | null>(null);
