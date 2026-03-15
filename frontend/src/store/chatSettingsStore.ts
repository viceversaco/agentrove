import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PermissionMode = 'plan' | 'ask' | 'auto';

const DEFAULT_KEY = '__default__';
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';
export const DEFAULT_THINKING_MODE: string | null = null;

interface ChatSettingsState {
  permissionModeByChat: Record<string, PermissionMode>;
  thinkingModeByChat: Record<string, string | null>;
  setPermissionMode: (chatId: string, mode: PermissionMode) => void;
  setThinkingMode: (chatId: string, mode: string | null) => void;
  initChatFromDefaults: (chatId: string) => void;
}

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set, get) => ({
      permissionModeByChat: {},
      thinkingModeByChat: {},
      setPermissionMode: (chatId, mode) =>
        set((state) => ({
          permissionModeByChat: { ...state.permissionModeByChat, [chatId]: mode },
        })),
      setThinkingMode: (chatId, mode) =>
        set((state) => ({
          thinkingModeByChat: { ...state.thinkingModeByChat, [chatId]: mode },
        })),
      initChatFromDefaults: (chatId) => {
        const state = get();
        const permission = state.permissionModeByChat[DEFAULT_KEY];
        const thinking = state.thinkingModeByChat[DEFAULT_KEY];
        const updates: Partial<Pick<ChatSettingsState, 'permissionModeByChat' | 'thinkingModeByChat'>> = {};
        if (permission !== undefined) {
          updates.permissionModeByChat = { ...state.permissionModeByChat, [chatId]: permission };
        }
        if (thinking !== undefined) {
          updates.thinkingModeByChat = { ...state.thinkingModeByChat, [chatId]: thinking };
        }
        if (Object.keys(updates).length > 0) set(updates);
      },
    }),
    { name: 'chat-settings-storage' },
  ),
);

export { DEFAULT_KEY as DEFAULT_CHAT_SETTINGS_KEY };
