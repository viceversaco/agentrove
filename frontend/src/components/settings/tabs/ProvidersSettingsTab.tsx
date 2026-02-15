import { useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Circle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Switch } from '@/components/ui/primitives/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { cn } from '@/utils/cn';
import type { CustomProvider, ProviderType } from '@/types/user.types';

interface ProvidersSettingsTabProps {
  providers: CustomProvider[] | null;
  onAddProvider: () => void;
  onEditProvider: (provider: CustomProvider) => void;
  onDeleteProvider: (providerId: string) => void;
  onToggleProvider: (providerId: string, enabled: boolean) => void;
}

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  copilot: 'GitHub Copilot',
  custom: 'Custom',
};

export const ProvidersSettingsTab: React.FC<ProvidersSettingsTabProps> = ({
  providers,
  onAddProvider,
  onEditProvider,
  onDeleteProvider,
  onToggleProvider,
}) => {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => new Set());
  const [providerPendingDelete, setProviderPendingDelete] = useState<CustomProvider | null>(null);

  const toggleExpanded = (providerId: string) => {
    setExpandedProviders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(providerId)) {
        newSet.delete(providerId);
      } else {
        newSet.add(providerId);
      }
      return newSet;
    });
  };

  const sortedProviders = [...(providers ?? [])].sort((a, b) => {
    const order: Record<ProviderType, number> = {
      anthropic: 0,
      openrouter: 1,
      copilot: 2,
      openai: 3,
      custom: 4,
    };
    return order[a.provider_type] - order[b.provider_type];
  });

  const handleConfirmDelete = () => {
    if (providerPendingDelete) {
      onDeleteProvider(providerPendingDelete.id);
      setProviderPendingDelete(null);
    }
  };

  if (!providers || providers.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            AI Providers
          </h2>
          <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Configure AI providers for model access. Add providers like Anthropic, OpenAI,
            OpenRouter, or custom endpoints.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-border py-10 text-center dark:border-border-dark">
          <p className="mb-3 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            No providers configured
          </p>
          <Button onClick={onAddProvider} variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Add Provider
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              AI Providers
            </h2>
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Configure AI providers for model access
            </p>
          </div>
          <Button onClick={onAddProvider} variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5" />
            Add Provider
          </Button>
        </div>

        <div className="space-y-2">
          {sortedProviders.map((provider) => {
            const isExpanded = expandedProviders.has(provider.id);

            return (
              <div
                key={provider.id}
                className="group rounded-xl border border-border transition-all duration-200 hover:border-border-hover dark:border-border-dark dark:hover:border-border-dark-hover"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(provider.id)}
                    className="flex-shrink-0 text-text-quaternary transition-colors hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                        {provider.name}
                      </h3>
                      <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        {PROVIDER_TYPE_LABELS[provider.provider_type]}
                      </span>
                      <Circle
                        className={cn(
                          'h-1.5 w-1.5 fill-current',
                          provider.auth_token
                            ? 'text-text-tertiary dark:text-text-dark-tertiary'
                            : 'text-text-quaternary dark:text-text-dark-quaternary',
                        )}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={provider.enabled}
                      onCheckedChange={(checked) => onToggleProvider(provider.id, checked)}
                      size="sm"
                    />
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditProvider(provider)}
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setProviderPendingDelete(provider)}
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {isExpanded && provider.models.length > 0 && (
                  <div className="border-t border-border px-4 py-3 dark:border-border-dark">
                    <div className="space-y-1">
                      {provider.models.map((model) => (
                        <div
                          key={model.model_id}
                          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-text-primary dark:text-text-dark-primary">
                              {model.name}
                            </span>
                            <span className="font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                              {model.model_id}
                            </span>
                          </div>
                          <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                            {model.enabled ? 'On' : 'Off'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isExpanded && provider.models.length === 0 && (
                  <div className="border-t border-border px-4 py-3 dark:border-border-dark">
                    <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      No models configured. Edit this provider to add models.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        isOpen={providerPendingDelete !== null}
        onClose={() => setProviderPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Provider"
        message={`Are you sure you want to delete "${providerPendingDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};
