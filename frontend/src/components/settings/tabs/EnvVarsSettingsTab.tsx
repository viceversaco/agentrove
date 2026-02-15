import { Button } from '@/components/ui/primitives/Button';
import { ListManagementTab } from '@/components/ui/ListManagementTab';
import type { CustomEnvVar } from '@/types/user.types';
import { Key, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

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
  const [revealedValues, setRevealedValues] = useState<Record<string, boolean>>({});

  const toggleValueVisibility = (key: string) => {
    setRevealedValues((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleDelete = async (index: number) => {
    const deletedKey = envVars?.[index]?.key;
    await onDeleteEnvVar(index);
    if (deletedKey) {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[deletedKey];
        return next;
      });
    }
  };

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
      onDelete={handleDelete}
      renderItem={(envVar) => (
        <>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="min-w-0 max-w-full truncate font-mono text-xs font-medium text-text-primary dark:text-text-dark-primary">
              {envVar.key}
            </h3>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="break-all font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {revealedValues[envVar.key] ? envVar.value : maskValue(envVar.value)}
            </p>
            <Button
              type="button"
              onClick={() => toggleValueVisibility(envVar.key)}
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              aria-label={
                revealedValues[envVar.key] ? `Hide ${envVar.key} value` : `Show ${envVar.key} value`
              }
            >
              {revealedValues[envVar.key] ? (
                <EyeOff className="h-3 w-3" />
              ) : (
                <Eye className="h-3 w-3" />
              )}
            </Button>
          </div>
        </>
      )}
      logContext="EnvVarsSettingsTab"
    />
  );
};
