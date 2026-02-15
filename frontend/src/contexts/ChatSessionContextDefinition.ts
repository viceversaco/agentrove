import { createContext } from 'react';
import type { Message, PermissionRequest } from '@/types';
import type { ContextUsageInfo } from '@/components/chat/message-input/ContextUsageIndicator';

export interface ChatSessionState {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  isInitialLoading: boolean;
  error: Error | null;
  copiedMessageId: string | null;
  pendingUserMessageId: string | null;
  attachedFiles: File[] | null;
  selectedModelId: string;
  contextUsage?: ContextUsageInfo;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  pendingPermissionRequest: PermissionRequest | null;
  isPermissionLoading: boolean;
  permissionError: string | null;
}

export interface ChatSessionActions {
  onSubmit: (e: React.FormEvent) => void;
  onStopStream: () => void;
  onCopy: (content: string, id: string) => void;
  onAttach: (files: File[]) => void;
  onModelChange: (modelId: string) => void;
  onDismissError: () => void;
  fetchNextPage: () => void;
  onRestoreSuccess: () => void;
  onPermissionApprove: () => void;
  onPermissionReject: (alternativeInstruction?: string) => void;
}

export interface ChatSessionContextValue {
  state: ChatSessionState;
  actions: ChatSessionActions;
}

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);
