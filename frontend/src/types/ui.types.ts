import type { Chat } from './chat.types';
import type { ToolAggregate } from './tools.types';

export type ToolComponent = React.FC<{ tool: ToolAggregate; chatId?: string }>;

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type MentionType = 'file' | 'agent' | 'prompt';

export interface MentionItem {
  type: MentionType;
  name: string;
  path: string;
  description?: string;
}

export interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export interface ModelSelectionState {
  modelByChat: Record<string, string>;
  selectModel: (chatId: string, modelId: string) => void;
}

export type ViewType =
  | 'agent'
  | 'browser'
  | 'diff'
  | 'editor'
  | 'ide'
  | 'terminal'
  | 'secrets'
  | 'webPreview'
  | 'mobilePreview';

export type SplitDirection = 'horizontal' | 'vertical';

export interface SplitViewState {
  isSplitMode: boolean;
  currentView: ViewType;
  secondaryView: ViewType | null;
  splitDirection: SplitDirection;
}

export interface SplitViewActions {
  setCurrentView: (view: ViewType) => void;
  setSecondaryView: (view: ViewType | null) => void;
  exitSplitMode: () => void;
  handleViewClick: (view: ViewType, isShiftClick: boolean) => void;
  setSplitDirection: (direction: SplitDirection) => void;
}

export interface UIState {
  currentChat: Chat | null;
  attachedFiles: File[];
  sidebarOpen: boolean;
}

export interface UIActions {
  setAttachedFiles: (files: File[]) => void;
  setCurrentChat: (chat: Chat | null) => void;
  setSidebarOpen: (isOpen: boolean) => void;
}

export interface SlashCommand {
  value: string;
  label: string;
  description?: string;
}
