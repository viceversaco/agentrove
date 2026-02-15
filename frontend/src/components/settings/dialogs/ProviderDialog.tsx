import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Select } from '@/components/ui/primitives/Select';
import { Switch } from '@/components/ui/primitives/Switch';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { SecretInput } from '../inputs/SecretInput';
import { OpenAIAuthButton } from '../inputs/OpenAIAuthButton';
import { CopilotAuthButton } from '../inputs/CopilotAuthButton';
import { ModelListEditor } from '../inputs/ModelListEditor';
import type { CustomProvider, CustomProviderModel, ProviderType } from '@/types/user.types';
import type { HelperTextCode, HelperTextLink } from '@/types/settings.types';

interface ProviderDialogProps {
  isOpen: boolean;
  provider: CustomProvider | null;
  error?: string | null;
  onClose: () => void;
  onSave: (provider: CustomProvider) => void;
}

const DEFAULT_ANTHROPIC_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'Anthropic',
  provider_type: 'anthropic',
  base_url: null,
  enabled: true,
  models: [
    { model_id: 'claude-opus-4-6', name: 'Claude Opus 4.6', enabled: true },
    { model_id: 'claude-opus-4-5', name: 'Claude Opus 4.5', enabled: true },
    { model_id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', enabled: true },
    { model_id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', enabled: true },
  ],
};

const DEFAULT_OPENROUTER_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'OpenRouter',
  provider_type: 'openrouter',
  base_url: null,
  enabled: true,
  models: [
    { model_id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', enabled: true },
    { model_id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', enabled: true },
    { model_id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', enabled: true },
    { model_id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5 ', enabled: true },
    { model_id: 'minimax/minimax-m2.1', name: 'Minimax M2.1', enabled: true },
    { model_id: 'deepseek/deepseek-v3.2', name: 'Deepseek V3.2', enabled: true },
  ],
};

const DEFAULT_OPENAI_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'OpenAI',
  provider_type: 'openai',
  base_url: null,
  enabled: true,
  models: [
    { model_id: 'gpt-5.3-codex', name: 'Codex 5.3', enabled: true },
    { model_id: 'gpt-5.2-codex', name: 'Codex 5.2', enabled: true },
    { model_id: 'gpt-5.2', name: 'GPT-5.2', enabled: true },
  ],
};

const DEFAULT_COPILOT_PROVIDER: Omit<CustomProvider, 'id' | 'auth_token'> = {
  name: 'GitHub Copilot',
  provider_type: 'copilot',
  base_url: null,
  enabled: true,
  models: [
    { model_id: 'gpt-5.2-codex', name: 'Codex 5.2', enabled: true },
    { model_id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', enabled: true },
    { model_id: 'claude-opus-4.6', name: 'Claude Opus 4.6', enabled: true },
  ],
};

const PROVIDER_TYPE_OPTIONS = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'copilot', label: 'GitHub Copilot' },
  { value: 'custom', label: 'Custom' },
];

const createEmptyProvider = (): CustomProvider => ({
  id: crypto.randomUUID(),
  name: '',
  provider_type: 'custom',
  base_url: '',
  auth_token: '',
  enabled: true,
  models: [],
});

const createProviderFromType = (providerType: ProviderType): CustomProvider => {
  const id = crypto.randomUUID();
  switch (providerType) {
    case 'anthropic':
      return { ...DEFAULT_ANTHROPIC_PROVIDER, id, auth_token: '' };
    case 'openrouter':
      return { ...DEFAULT_OPENROUTER_PROVIDER, id, auth_token: '' };
    case 'openai':
      return { ...DEFAULT_OPENAI_PROVIDER, id, auth_token: '' };
    case 'copilot':
      return { ...DEFAULT_COPILOT_PROVIDER, id, auth_token: '' };
    default:
      return createEmptyProvider();
  }
};

const getAuthTokenConfig = (
  providerType: ProviderType,
): {
  label: string;
  placeholder: string;
  helperText?: HelperTextCode | HelperTextLink;
} => {
  switch (providerType) {
    case 'anthropic':
      return {
        label: 'OAuth Token',
        placeholder: 'Paste token from claude setup-token',
        helperText: {
          prefix: 'Requires Claude Max ($100-200/mo). Run',
          code: 'claude setup-token',
          suffix: 'in terminal',
        },
      };
    case 'openrouter':
      return {
        label: 'API Key',
        placeholder: 'Enter your OpenRouter API key',
        helperText: {
          prefix: 'Get your API key from',
          anchorText: 'openrouter.ai',
          href: 'https://openrouter.ai/keys',
        },
      };
    case 'openai':
      return {
        label: 'OpenAI Authentication',
        placeholder: '',
        helperText: {
          prefix: 'Requires a',
          anchorText: 'ChatGPT Pro/Plus subscription',
          href: 'https://openai.com',
        },
      };
    case 'copilot':
      return {
        label: 'GitHub Authentication',
        placeholder: '',
        helperText: {
          prefix: 'Requires a',
          anchorText: 'GitHub Copilot subscription',
          href: 'https://github.com/features/copilot',
        },
      };
    case 'custom':
    default:
      return {
        label: 'API Key',
        placeholder: 'Enter API key (if required)',
        helperText: {
          prefix: 'API key for authentication (if required)',
          code: '',
          suffix: '',
        },
      };
  }
};

export const ProviderDialog: React.FC<ProviderDialogProps> = ({
  isOpen,
  provider,
  error,
  onClose,
  onSave,
}) => {
  const [form, setForm] = useState<CustomProvider>(() => createEmptyProvider());
  const [showToken, setShowToken] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<ProviderType>('anthropic');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (provider) {
        setForm({ ...provider });
        setSelectedProviderType(provider.provider_type);
      } else {
        setSelectedProviderType('anthropic');
        setForm(createProviderFromType('anthropic'));
      }
      setLocalError(null);
      setShowToken(false);
    }
  }, [isOpen, provider]);

  const handleProviderTypeChange = (providerType: ProviderType) => {
    setSelectedProviderType(providerType);
    const currentToken = form.auth_token;
    const newProviderForm = createProviderFromType(providerType);
    setForm({ ...newProviderForm, auth_token: currentToken });
    setLocalError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const builtInTypes = ['anthropic', 'openrouter', 'openai', 'copilot'];
    if (builtInTypes.includes(form.provider_type) && !form.auth_token) {
      setLocalError('Authentication is required for this provider type.');
      return;
    }
    onSave(form);
  };

  const handleModelsChange = (models: CustomProviderModel[]) => {
    setForm((prev) => ({ ...prev, models }));
  };

  const isEditing = provider !== null;
  const isBuiltIn =
    form.provider_type === 'anthropic' ||
    form.provider_type === 'openrouter' ||
    form.provider_type === 'openai' ||
    form.provider_type === 'copilot';
  const showBaseUrl = !isBuiltIn;
  const authConfig = getAuthTokenConfig(form.provider_type);
  const errorMessage = localError ?? error;

  const getDialogTitle = () => {
    if (isEditing) return 'Edit Provider';
    switch (selectedProviderType) {
      case 'anthropic':
        return 'Add Anthropic Provider';
      case 'openrouter':
        return 'Add OpenRouter Provider';
      case 'openai':
        return 'Add OpenAI Provider';
      case 'copilot':
        return 'Add GitHub Copilot Provider';
      default:
        return 'Add Custom Provider';
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" className="max-h-[90vh] overflow-y-auto">
      <div className="p-5">
        <h3 className="mb-5 text-sm font-medium text-text-primary dark:text-text-dark-primary">
          {getDialogTitle()}
        </h3>

        {errorMessage && (
          <div className="mb-4 rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {errorMessage}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEditing && (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                Provider Type
              </Label>
              <Select
                value={selectedProviderType}
                onChange={(e) => handleProviderTypeChange(e.target.value as ProviderType)}
              >
                {PROVIDER_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {selectedProviderType === 'custom'
                  ? 'Configure a custom Anthropic-compatible API provider'
                  : selectedProviderType === 'openai'
                    ? 'Use OpenAI models with your ChatGPT subscription'
                    : selectedProviderType === 'copilot'
                      ? 'Use AI models with your GitHub Copilot subscription'
                      : `Pre-configured with default ${selectedProviderType === 'anthropic' ? 'Claude' : 'OpenRouter'} models`}
              </p>
            </div>
          )}

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Provider Name
            </Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={isEditing ? undefined : 'e.g., DeepSeek, Local Ollama'}
              className="text-xs"
              required
            />
          </div>

          {showBaseUrl && (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                Base URL
              </Label>
              <Input
                value={form.base_url || ''}
                onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
                placeholder="https://api.example.com/v1"
                className="font-mono text-xs"
                required
              />
              <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                The base URL for the Anthropic-compatible API endpoint
              </p>
            </div>
          )}

          {form.provider_type === 'openai' ? (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                OpenAI Authentication
              </Label>
              <OpenAIAuthButton
                value={form.auth_token || null}
                onChange={(token) => {
                  setForm((prev) => ({ ...prev, auth_token: token || '' }));
                  setLocalError(null);
                }}
              />
            </div>
          ) : form.provider_type === 'copilot' ? (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                GitHub Copilot Authentication
              </Label>
              <CopilotAuthButton
                value={form.auth_token || null}
                onChange={(token) => {
                  setForm((prev) => ({ ...prev, auth_token: token || '' }));
                  setLocalError(null);
                }}
              />
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
                {authConfig.label}
              </Label>
              <SecretInput
                value={form.auth_token || ''}
                onChange={(value) => setForm((prev) => ({ ...prev, auth_token: value }))}
                placeholder={authConfig.placeholder}
                isVisible={showToken}
                onToggleVisibility={() => setShowToken(!showToken)}
                helperText={authConfig.helperText}
                containerClassName="w-full"
              />
            </div>
          )}

          <ModelListEditor models={form.models} onChange={handleModelsChange} />

          <div className="flex items-center justify-between rounded-xl border border-border px-3.5 py-3 dark:border-border-dark">
            <div>
              <span className="text-xs text-text-primary dark:text-text-dark-primary">
                Enable Provider
              </span>
              <p className="mt-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Models will only be available when enabled
              </p>
            </div>
            <Switch
              checked={form.enabled ?? true}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))}
              size="sm"
              aria-label="Enable provider"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose} variant="outline" size="sm">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
            >
              {isEditing ? 'Save Changes' : 'Add Provider'}
            </Button>
          </div>
        </form>
      </div>
    </BaseModal>
  );
};
