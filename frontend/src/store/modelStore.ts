import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelSelectionState } from '@/types/ui.types';

export const useModelStore = create<ModelSelectionState>()(
  persist(
    (set) => ({
      selectedModelId: '',
      selectModel: (modelId: string) => {
        const trimmedId = modelId?.trim();
        if (trimmedId) {
          set({ selectedModelId: trimmedId });
        }
      },
    }),
    { name: 'model-storage' },
  ),
);
