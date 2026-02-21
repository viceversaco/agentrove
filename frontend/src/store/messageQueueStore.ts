import { create } from 'zustand';
import type { LocalQueuedMessage } from '@/types/queue.types';
import { queueService } from '@/services/queueService';

export const EMPTY_QUEUE: LocalQueuedMessage[] = [];

interface MessageQueueState {
  queues: Map<string, LocalQueuedMessage[]>;
  isSyncing: Map<string, boolean>;

  queueMessage: (
    chatId: string,
    content: string,
    modelId: string,
    permissionMode?: string,
    thinkingMode?: string | null,
    files?: File[],
  ) => Promise<string>;
  updateQueuedMessage: (chatId: string, messageId: string, content: string) => Promise<void>;
  removeMessage: (chatId: string, messageId: string) => Promise<void>;
  clearAndSync: (chatId: string) => Promise<void>;
  getQueue: (chatId: string) => LocalQueuedMessage[];
  sendNow: (chatId: string, messageId: string) => Promise<boolean>;
  clearQueue: (chatId: string) => void;
  fetchQueue: (chatId: string) => Promise<void>;
  syncPendingMessages: (chatId: string) => Promise<void>;
  removeLocalOnly: (chatId: string, messageId: string) => void;
  cleanupChat: (chatId: string) => void;
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map<string, LocalQueuedMessage[]>(),
  isSyncing: new Map<string, boolean>(),

  queueMessage: async (
    chatId: string,
    content: string,
    modelId: string,
    permissionMode: string = 'auto',
    thinkingMode: string | null = null,
    files?: File[],
  ): Promise<string> => {
    const currentQueue = get().queues.get(chatId) || [];
    const tempId = crypto.randomUUID();
    const tempMessage: LocalQueuedMessage = {
      id: tempId,
      content,
      model_id: modelId,
      files,
      queuedAt: Date.now(),
      synced: false,
      sendingNow: false,
    };

    set((state) => {
      const nextQueues = new Map(state.queues);
      nextQueues.set(chatId, [...currentQueue, tempMessage]);
      return { queues: nextQueues };
    });

    try {
      const result = await queueService.queueMessage(
        chatId,
        content,
        modelId,
        permissionMode,
        thinkingMode,
        files,
      );

      set((state) => {
        const nextQueues = new Map(state.queues);
        const queue = nextQueues.get(chatId) || [];
        const updatedQueue = queue.map((msg) =>
          msg.id === tempId ? { ...msg, id: result.id, synced: true } : msg,
        );
        nextQueues.set(chatId, updatedQueue);
        return { queues: nextQueues };
      });

      return result.id;
    } catch (error) {
      const isNetworkError =
        error instanceof TypeError || (error instanceof Error && error.message.includes('network'));

      if (!isNetworkError) {
        get().removeLocalOnly(chatId, tempId);
        throw error;
      }

      return tempId;
    }
  },

  updateQueuedMessage: async (chatId: string, messageId: string, content: string) => {
    const trimmedContent = content.trim();
    const currentQueue = get().queues.get(chatId) || [];
    const message = currentQueue.find((m) => m.id === messageId);

    if (!message) {
      return;
    }

    if (!trimmedContent) {
      await get().removeMessage(chatId, messageId);
      return;
    }

    set((state) => {
      const nextQueues = new Map(state.queues);
      const queue = nextQueues.get(chatId) || [];
      const updatedQueue = queue.map((msg) =>
        msg.id === messageId ? { ...msg, content: trimmedContent } : msg,
      );
      nextQueues.set(chatId, updatedQueue);
      return { queues: nextQueues };
    });

    if (message.synced) {
      try {
        await queueService.updateQueuedMessage(chatId, messageId, trimmedContent);
      } catch (error) {
        console.error('Failed to sync message update:', error);
      }
    }
  },

  removeMessage: async (chatId: string, messageId: string) => {
    const currentQueue = get().queues.get(chatId) || [];
    const message = currentQueue.find((m) => m.id === messageId);

    set((state) => {
      const nextQueues = new Map(state.queues);
      const queue = nextQueues.get(chatId) || [];
      const filtered = queue.filter((msg) => msg.id !== messageId);
      if (filtered.length === 0) {
        nextQueues.delete(chatId);
      } else {
        nextQueues.set(chatId, filtered);
      }
      return { queues: nextQueues };
    });

    if (message?.synced) {
      try {
        await queueService.deleteQueuedMessage(chatId, messageId);
      } catch (error) {
        console.error('Failed to sync message delete:', error);
      }
    }
  },

  clearAndSync: async (chatId: string) => {
    const queue = get().queues.get(chatId) || [];
    const hasSynced = queue.some((m) => m.synced);

    set((state) => {
      const nextQueues = new Map(state.queues);
      nextQueues.delete(chatId);
      return { queues: nextQueues };
    });

    if (hasSynced) {
      try {
        await queueService.clearQueue(chatId);
      } catch (error) {
        console.error('Failed to sync queue clear:', error);
      }
    }
  },

  sendNow: async (chatId: string, messageId: string): Promise<boolean> => {
    const queue = get().queues.get(chatId) || [];
    const message = queue.find((m) => m.id === messageId);
    if (!message?.synced) return false;

    const resetSendingNow = () => {
      set((state) => {
        const nextQueues = new Map(state.queues);
        const currentQueue = nextQueues.get(chatId) || [];
        nextQueues.set(
          chatId,
          currentQueue.map((msg) => (msg.id === messageId ? { ...msg, sendingNow: false } : msg)),
        );
        return { queues: nextQueues };
      });
    };

    set((state) => {
      const nextQueues = new Map(state.queues);
      const currentQueue = nextQueues.get(chatId) || [];
      nextQueues.set(
        chatId,
        currentQueue.map((msg) => (msg.id === messageId ? { ...msg, sendingNow: true } : msg)),
      );
      return { queues: nextQueues };
    });

    const timeout = window.setTimeout(resetSendingNow, 30_000);

    try {
      await queueService.sendNow(chatId, messageId);
      clearTimeout(timeout);
      return true;
    } catch (error) {
      console.error('Failed to send now:', error);
      clearTimeout(timeout);
      resetSendingNow();
      return false;
    }
  },

  removeLocalOnly: (chatId: string, messageId: string) => {
    set((state) => {
      const nextQueues = new Map(state.queues);
      const currentQueue = nextQueues.get(chatId) || [];
      const filteredQueue = currentQueue.filter((msg) => msg.id !== messageId);

      if (filteredQueue.length === 0) {
        nextQueues.delete(chatId);
      } else {
        nextQueues.set(chatId, filteredQueue);
      }

      return { queues: nextQueues };
    });
  },

  getQueue: (chatId: string) => {
    return get().queues.get(chatId) ?? EMPTY_QUEUE;
  },

  clearQueue: (chatId: string) => {
    set((state) => {
      const nextQueues = new Map(state.queues);
      nextQueues.delete(chatId);
      return { queues: nextQueues };
    });
  },

  cleanupChat: (chatId: string) => {
    set((state) => {
      const nextQueues = new Map(state.queues);
      const nextSyncing = new Map(state.isSyncing);
      nextQueues.delete(chatId);
      nextSyncing.delete(chatId);
      return { queues: nextQueues, isSyncing: nextSyncing };
    });
  },

  fetchQueue: async (chatId: string) => {
    try {
      const serverMessages = await queueService.getQueue(chatId);

      set((state) => {
        const nextQueues = new Map(state.queues);
        const existingQueue = nextQueues.get(chatId) || [];

        const serverIds = new Set(serverMessages.map((m) => m.id));
        const pendingMessages = existingQueue.filter((m) => !m.synced && !serverIds.has(m.id));

        const syncedMessages: LocalQueuedMessage[] = serverMessages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          model_id: msg.model_id,
          attachments: msg.attachments,
          queuedAt: new Date(msg.queued_at).getTime(),
          synced: true,
          sendingNow: false,
        }));

        const merged = [...syncedMessages, ...pendingMessages];
        if (merged.length > 0) {
          nextQueues.set(chatId, merged);
        } else {
          nextQueues.delete(chatId);
        }

        return { queues: nextQueues };
      });
    } catch (error) {
      console.error('Failed to fetch queue:', error);
    }
  },

  syncPendingMessages: async (chatId: string) => {
    const state = get();
    if (state.isSyncing.get(chatId)) {
      return;
    }

    set((s) => {
      const nextSyncing = new Map(s.isSyncing);
      nextSyncing.set(chatId, true);
      return { isSyncing: nextSyncing };
    });

    try {
      const queue = state.queues.get(chatId) || [];
      const pendingMessages = queue.filter((m) => !m.synced);

      for (const msg of pendingMessages) {
        try {
          const result = await queueService.queueMessage(
            chatId,
            msg.content,
            msg.model_id,
            'auto',
            null,
            msg.files,
          );

          set((s) => {
            const nextQueues = new Map(s.queues);
            const currentQueue = nextQueues.get(chatId) || [];
            const updatedQueue = currentQueue.map((m) =>
              m.id === msg.id ? { ...m, id: result.id, synced: true } : m,
            );
            nextQueues.set(chatId, updatedQueue);
            return { queues: nextQueues };
          });
        } catch (error) {
          console.error('Failed to sync pending message:', error);
          break;
        }
      }
    } finally {
      set((s) => {
        const nextSyncing = new Map(s.isSyncing);
        nextSyncing.delete(chatId);
        return { isSyncing: nextSyncing };
      });
    }
  },
}));
