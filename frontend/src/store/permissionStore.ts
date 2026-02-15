import { create } from 'zustand';
import type { PermissionRequest } from '@/types/chat.types';

interface PermissionState {
  pendingRequests: Map<string, PermissionRequest>;
  setPermissionRequest: (chatId: string, request: PermissionRequest) => void;
  clearPermissionRequest: (chatId: string) => void;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  pendingRequests: new Map<string, PermissionRequest>(),

  setPermissionRequest: (chatId: string, request: PermissionRequest) => {
    set((state) => {
      const nextRequests = new Map(state.pendingRequests);
      nextRequests.set(chatId, request);
      return { pendingRequests: nextRequests };
    });
  },

  clearPermissionRequest: (chatId: string) => {
    set((state) => {
      const nextRequests = new Map(state.pendingRequests);
      nextRequests.delete(chatId);
      return { pendingRequests: nextRequests };
    });
  },
}));
