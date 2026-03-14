import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Switch } from '@/components/ui/primitives/Switch';
import type { CustomProviderModel } from '@/types/user.types';

interface ModelListEditorProps {
  models: CustomProviderModel[];
  onChange: (models: CustomProviderModel[]) => void;
}

const formatContextWindow = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  return `${tokens / 1_000}K`;
};

const createEmptyModel = (): CustomProviderModel => ({
  model_id: '',
  name: '',
  enabled: true,
  context_window: null,
});

export const ModelListEditor: React.FC<ModelListEditorProps> = ({ models, onChange }) => {
  const [newModel, setNewModel] = useState<CustomProviderModel>(() => createEmptyModel());
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editModel, setEditModel] = useState<CustomProviderModel>(() => createEmptyModel());

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

  const handleStartEdit = (model: CustomProviderModel) => {
    setIsAdding(false);
    setEditingModelId(model.model_id);
    setEditModel({ ...model });
    setError(null);
  };

  const handleSaveEdit = () => {
    if (!editModel.model_id.trim()) {
      setError('Model ID is required');
      return;
    }
    if (!editModel.name.trim()) {
      setError('Model name is required');
      return;
    }
    const trimmedId = editModel.model_id.trim();
    if (trimmedId !== editingModelId && models.some((m) => m.model_id === trimmedId)) {
      setError('A model with this ID already exists');
      return;
    }
    onChange(
      models.map((m) =>
        m.model_id === editingModelId
          ? { ...editModel, model_id: trimmedId, name: editModel.name.trim() }
          : m,
      ),
    );
    setEditingModelId(null);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingModelId(null);
    setError(null);
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
            onClick={() => { setIsAdding(true); setEditingModelId(null); }}
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
              onClick={() => { setIsAdding(true); setEditingModelId(null); }}
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
          <div key={model.model_id}>
            {editingModelId === model.model_id ? (
              <div className="px-3.5 py-3">
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <Input
                    value={editModel.model_id}
                    onChange={(e) => setEditModel((prev) => ({ ...prev, model_id: e.target.value }))}
                    aria-label="Model ID"
                    className="font-mono text-2xs"
                  />
                  <Input
                    value={editModel.name}
                    onChange={(e) => setEditModel((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Display Name"
                    aria-label="Model name"
                    className="text-2xs"
                    autoFocus
                  />
                </div>
                <div className="mb-2">
                  <Input
                    value={editModel.context_window ?? ''}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setEditModel((prev) => ({
                        ...prev,
                        context_window: val ? Number(val) : null,
                      }));
                    }}
                    placeholder="Context window (e.g. 200000)"
                    aria-label="Context window"
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
                    onClick={handleSaveEdit}
                    variant="outline"
                    size="sm"
                    className="flex-1 text-2xs"
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCancelEdit}
                    variant="ghost"
                    size="sm"
                    className="text-2xs text-text-quaternary dark:text-text-dark-quaternary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-surface-hover/30 dark:hover:bg-surface-dark-hover/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      {model.name}
                    </span>
                    <span className="truncate font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      {model.model_id}
                    </span>
                    {model.context_window && (
                      <span className="shrink-0 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        {formatContextWindow(model.context_window)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleStartEdit(model)}
                  aria-label="Edit model"
                  className="h-5 w-5 shrink-0 text-text-quaternary transition-colors hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <Switch
                  checked={model.enabled}
                  onCheckedChange={() => handleToggleModel(model.model_id)}
                  size="sm"
                  aria-label={model.enabled ? 'Disable model' : 'Enable model'}
                />
                <button
                  type="button"
                  onClick={() => handleRemoveModel(model.model_id)}
                  aria-label="Remove model"
                  className="h-5 w-5 shrink-0 text-text-quaternary transition-colors hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {index < models.length - 1 && editingModelId !== model.model_id && (
              <div className="mx-3.5 border-b border-border dark:border-border-dark" />
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
                aria-label="Model ID"
                className="font-mono text-2xs"
                autoFocus
              />
              <Input
                value={newModel.name}
                onChange={(e) => setNewModel((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Display Name"
                aria-label="Model name"
                className="text-2xs"
              />
            </div>
            <div className="mb-2">
              <Input
                value={newModel.context_window ?? ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setNewModel((prev) => ({
                    ...prev,
                    context_window: val ? Number(val) : null,
                  }));
                }}
                placeholder="Context window (e.g. 200000)"
                aria-label="Context window"
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
