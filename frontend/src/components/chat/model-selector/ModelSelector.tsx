import { memo, useMemo, useEffect } from 'react';
import { Dropdown } from '@/components/ui/primitives/Dropdown';
import type { DropdownItemType } from '@/components/ui/primitives/Dropdown';
import { useAuthStore, useUIStore } from '@/store';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import type { Model } from '@/types/chat.types';

const groupModelsByProvider = (models: Model[]) => {
  const groups = new Map<string, { name: string; models: Model[] }>();

  models.forEach((model) => {
    const key = model.provider_id;
    if (!groups.has(key)) {
      groups.set(key, { name: model.provider_name, models: [] });
    }
    groups.get(key)!.models.push(model);
  });

  return Array.from(groups.values()).map((group) => ({
    label: group.name,
    items: group.models,
  }));
};

export interface ModelSelectorProps {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
}

export const ModelSelector = memo(function ModelSelector({
  selectedModelId,
  onModelChange,
  dropdownPosition = 'bottom',
  disabled = false,
}: ModelSelectorProps) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isSplitMode = useUIStore((state) => state.isSplitMode);
  const { models, isLoading } = useModelSelection({ enabled: isAuthenticated });

  const groupedItems = useMemo(() => {
    const groups = groupModelsByProvider(models);
    const items: DropdownItemType<Model>[] = [];

    groups.forEach((group) => {
      items.push({ type: 'header', label: group.label });
      group.items.forEach((model) => {
        items.push({ type: 'item', data: model });
      });
    });

    return items;
  }, [models]);

  const selectedModel = models.find((m) => m.model_id === selectedModelId);

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      onModelChange(models[0].model_id);
    }
  }, [models, selectedModel, onModelChange]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <div className="h-3.5 w-16 animate-pulse rounded-full bg-text-quaternary/20" />
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1">
        <span className="text-xs text-text-quaternary">No models</span>
      </div>
    );
  }

  return (
    <Dropdown
      value={selectedModel || models[0]}
      items={groupedItems}
      getItemKey={(model) => model.model_id}
      getItemLabel={(model) => `${model.provider_name} - ${model.name}`}
      getItemShortLabel={(model) => model.name}
      onSelect={(model) => onModelChange(model.model_id)}
      width="w-64"
      dropdownPosition={dropdownPosition}
      disabled={disabled}
      compactOnMobile
      forceCompact={isSplitMode}
      searchable
      searchPlaceholder="Search models..."
      renderItem={(model, isSelected) => (
        <span
          className={`truncate text-xs font-medium ${isSelected ? 'text-text-primary dark:text-text-dark-primary' : 'text-text-secondary dark:text-text-dark-secondary'}`}
        >
          {model.name}
        </span>
      )}
    />
  );
});
