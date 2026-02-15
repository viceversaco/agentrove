import { create } from 'zustand';
import type { Chat } from '@/types/chat.types';
import type { UIActions, UIState } from '@/types/ui.types';

type ChatStoreType = Pick<UIState, 'currentChat' | 'attachedFiles'> &
  Pick<UIActions, 'setCurrentChat' | 'setAttachedFiles'>;

export const useChatStore = create<ChatStoreType>((set) => ({
  currentChat: null,
  attachedFiles: [],
  setCurrentChat: (chat: Chat | null) => set({ currentChat: chat }),
  setAttachedFiles: (files) => set({ attachedFiles: files }),
}));
