import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Switch } from '@/components/ui/primitives/Switch';
import type { CustomProviderModel } from '@/types/user.types';

interface ModelListEditorProps {
  models: CustomProviderModel[];
  onChange: (models: CustomProviderModel[]) => void;
}

const createEmptyModel = (): CustomProviderModel => ({
  model_id: '',
  name: '',
  enabled: true,
});

export const ModelListEditor: React.FC<ModelListEditorProps> = ({ models, onChange }) => {
  const [newModel, setNewModel] = useState<CustomProviderModel>(() => createEmptyModel());
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddModel = () => {
    if (!newModel.model_id.trim()) {
      setError('Model ID is required');
      return;
    }
    if (!newModel.name.trim()) {
      setError('Model name is required');
      return;
    }
    if (models.some((m) => m.model_id === newModel.model_id.trim())) {
      setError('A model with this ID already exists');
      return;
    }

    onChange([
      ...models,
      { ...newModel, model_id: newModel.model_id.trim(), name: newModel.name.trim() },
    ]);
    setNewModel(createEmptyModel());
    setError(null);
    setIsAdding(false);
  };

  const handleRemoveModel = (modelId: string) => {
    onChange(models.filter((m) => m.model_id !== modelId));
  };

  const handleToggleModel = (modelId: string) => {
    onChange(models.map((m) => (m.model_id === modelId ? { ...m, enabled: !m.enabled } : m)));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
          Models
          {models.length > 0 && (
            <span className="ml-1 text-text-quaternary dark:text-text-dark-quaternary">
              ({models.length})
            </span>
          )}
        </span>
        {!isAdding && (
          <Button
            type="button"
            onClick={() => setIsAdding(true)}
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-2xs text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>

      <div className="space-y-px rounded-xl border border-border dark:border-border-dark">
        {models.length === 0 && !isAdding && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
              No models configured
            </p>
            <Button
              type="button"
              onClick={() => setIsAdding(true)}
              variant="ghost"
              size="sm"
              className="mt-2 h-6 gap-1 px-2 text-2xs text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
            >
              <Plus className="h-3 w-3" />
              Add model
            </Button>
          </div>
        )}

        {models.map((model, index) => (
          <div
            key={model.model_id}
            className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-surface-hover/30 dark:hover:bg-surface-dark-hover/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                  {model.name}
                </span>
                <span className="truncate font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {model.model_id}
                </span>
              </div>
            </div>
            <Switch
              checked={model.enabled}
              onCheckedChange={() => handleToggleModel(model.model_id)}
              size="sm"
              aria-label={model.enabled ? 'Disable model' : 'Enable model'}
            />
            <button
              type="button"
              onClick={() => handleRemoveModel(model.model_id)}
              className="h-5 w-5 shrink-0 text-text-quaternary transition-colors hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            >
              <X className="h-3 w-3" />
            </button>
            {index < models.length - 1 && (
              <div className="absolute inset-x-3.5 bottom-0 border-b border-border dark:border-border-dark" />
            )}
          </div>
        ))}

        {isAdding && (
          <div className="border-t border-border px-3.5 py-3 dark:border-border-dark">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <Input
                value={newModel.model_id}
                onChange={(e) => setNewModel((prev) => ({ ...prev, model_id: e.target.value }))}
                placeholder="model-id"
                className="font-mono text-2xs"
                autoFocus
              />
              <Input
                value={newModel.name}
                onChange={(e) => setNewModel((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Display Name"
                className="text-2xs"
              />
            </div>
            {error && (
              <p className="mb-2 text-2xs text-text-secondary dark:text-text-dark-secondary">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={handleAddModel}
                variant="outline"
                size="sm"
                className="flex-1 text-2xs"
              >
                Add Model
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setNewModel(createEmptyModel());
                  setError(null);
                }}
                variant="ghost"
                size="sm"
                className="text-2xs text-text-quaternary dark:text-text-dark-quaternary"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
