import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomPrompt } from '@/types/user.types';
import { FileText } from 'lucide-react';

interface PromptsSettingsTabProps {
  prompts: CustomPrompt[] | null;
  onAddPrompt: () => void;
  onEditPrompt: (index: number) => void;
  onDeletePrompt: (index: number) => void | Promise<void>;
}

export const PromptsSettingsTab: React.FC<PromptsSettingsTabProps> = ({
  prompts,
  onAddPrompt,
  onEditPrompt,
  onDeletePrompt,
}) => {
  return (
    <ListManagementTab<CustomPrompt>
      title="Prompts"
      description="Create custom system prompts. Use @prompt:name to select when chatting."
      items={prompts}
      emptyIcon={FileText}
      emptyText="No custom prompts configured yet"
      emptyButtonText="Create Your First Prompt"
      addButtonText="Add Prompt"
      deleteConfirmTitle="Delete Prompt"
      deleteConfirmMessage={(prompt) =>
        `Are you sure you want to delete "${prompt.name}"? This action cannot be undone.`
      }
      getItemKey={(prompt) => prompt.name}
      onAdd={onAddPrompt}
      onEdit={onEditPrompt}
      onDelete={onDeletePrompt}
      renderItem={(prompt) => (
        <>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {prompt.name}
            </h3>
          </div>
          <p className="line-clamp-3 font-mono text-2xs leading-relaxed text-text-quaternary dark:text-text-dark-quaternary">
            {prompt.content}
          </p>
        </>
      )}
      logContext="PromptsSettingsTab"
    />
  );
};
