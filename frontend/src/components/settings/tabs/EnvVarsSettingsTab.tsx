import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomEnvVar } from '@/types/user.types';
import { Key } from 'lucide-react';

interface EnvVarsSettingsTabProps {
  envVars: CustomEnvVar[] | null;
  onAddEnvVar: () => void;
  onEditEnvVar: (index: number) => void;
  onDeleteEnvVar: (index: number) => void | Promise<void>;
}

const maskValue = (value: string) => {
  if (value.length <= 4) return '····';
  return `${value.slice(0, 4)}${'·'.repeat(Math.min(value.length - 4, 16))}`;
};

export const EnvVarsSettingsTab: React.FC<EnvVarsSettingsTabProps> = ({
  envVars,
  onAddEnvVar,
  onEditEnvVar,
  onDeleteEnvVar,
}) => {
  return (
    <ListManagementTab<CustomEnvVar>
      title="Environment Variables"
      description="Configure environment variables that will be available in every sandbox. Perfect for API keys like OPENAI_API_KEY, GEMINI_API_KEY, etc."
      items={envVars}
      emptyIcon={Key}
      emptyText="No custom environment variables configured yet"
      emptyButtonText="Add Your First Environment Variable"
      addButtonText="Add Variable"
      deleteConfirmTitle="Delete Environment Variable"
      deleteConfirmMessage={(envVar) =>
        `Are you sure you want to delete "${envVar.key}"? This action cannot be undone.`
      }
      getItemKey={(envVar) => envVar.key}
      onAdd={onAddEnvVar}
      onEdit={onEditEnvVar}
      onDelete={onDeleteEnvVar}
      renderItem={(envVar) => (
        <>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate font-mono text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {envVar.key}
            </h3>
          </div>
          <p className="break-all font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {maskValue(envVar.value)}
          </p>
        </>
      )}
      logContext="EnvVarsSettingsTab"
    />
  );
};
