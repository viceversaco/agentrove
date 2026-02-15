import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Switch } from '@/components/ui/primitives/Switch';
import { SegmentedControl } from '@/components/ui/primitives/SegmentedControl';
import type { ApiFieldKey, GeneralSecretFieldConfig } from '@/types/settings.types';
import type { UserSettings, SandboxProviderType } from '@/types/user.types';
import { SecretInput } from '@/components/settings/inputs/SecretInput';
import { cn } from '@/utils/cn';

interface GeneralSettingsTabProps {
  fields: GeneralSecretFieldConfig[];
  settings: UserSettings;
  savedSettings: UserSettings | undefined;
  revealedFields: Record<ApiFieldKey, boolean>;
  onSecretChange: (field: ApiFieldKey, value: string) => void;
  onToggleVisibility: (field: ApiFieldKey) => void;
  onDeleteAllChats: () => void;
  onNotificationSoundChange: (enabled: boolean) => void;
  onAutoCompactDisabledChange: (disabled: boolean) => void;
  onAttributionDisabledChange: (disabled: boolean) => void;
  onSandboxProviderChange: (provider: SandboxProviderType) => void;
  onTimezoneChange: (timezone: string) => void;
}

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border p-5 dark:border-border-dark', className)}>
      <h2 className="mb-4 text-xs font-medium text-text-tertiary dark:text-text-dark-tertiary">
        {title}
      </h2>
      {children}
    </div>
  );
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  fields,
  settings,
  savedSettings,
  revealedFields,
  onSecretChange,
  onToggleVisibility,
  onDeleteAllChats,
  onNotificationSoundChange,
  onAutoCompactDisabledChange,
  onAttributionDisabledChange,
  onSandboxProviderChange,
  onTimezoneChange,
}) => (
  <div className="space-y-4">
    <SectionCard title="API Keys & Authentication">
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field.key}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  {field.label}
                </h3>
                <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                  {field.description}
                </p>
              </div>
            </div>
            <SecretInput
              value={settings[field.key] ?? ''}
              placeholder={field.placeholder}
              isVisible={revealedFields[field.key]}
              onChange={(value) => onSecretChange(field.key, value)}
              onToggleVisibility={() => onToggleVisibility(field.key)}
              helperText={field.helperText}
            />
          </div>
        ))}
      </div>
    </SectionCard>

    <SectionCard title="Sandbox Provider">
      <div className="space-y-4">
        <p className="mb-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Select the sandbox environment for code execution. E2B and Modal require API keys.
        </p>
        <SegmentedControl
          layoutId="sandbox-provider"
          value={settings.sandbox_provider ?? 'docker'}
          onChange={(val) => onSandboxProviderChange(val as SandboxProviderType)}
          options={[
            { value: 'host', label: 'Host (Local)', disabled: false },
            { value: 'docker', label: 'Docker (Local)', disabled: false },
            { value: 'e2b', label: 'E2B (Cloud)', disabled: !savedSettings?.e2b_api_key },
            { value: 'modal', label: 'Modal (Cloud)', disabled: !savedSettings?.modal_api_key },
          ]}
        />
      </div>
    </SectionCard>

    <SectionCard title="Timezone">
      <div className="space-y-2">
        <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Used for scheduled tasks. Example: America/Los_Angeles
        </p>
        <Input
          value={settings.timezone}
          onChange={(event) => onTimezoneChange(event.target.value)}
          placeholder="America/Los_Angeles"
        />
      </div>
    </SectionCard>

    <SectionCard title="Preferences">
      <div className="divide-y divide-border dark:divide-border-dark">
        <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0 sm:items-center">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Sound Notification
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Play a sound when the assistant finishes responding.
            </p>
          </div>
          <Switch
            checked={settings.notification_sound_enabled ?? true}
            onCheckedChange={onNotificationSoundChange}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Disable Auto Compact
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Prevents Claude from automatically compacting conversation history.
            </p>
          </div>
          <Switch
            checked={settings.auto_compact_disabled ?? false}
            onCheckedChange={onAutoCompactDisabledChange}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Disable Attribution
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Removes Claude attribution from commits and pull requests.
            </p>
          </div>
          <Switch
            checked={settings.attribution_disabled ?? false}
            onCheckedChange={onAttributionDisabledChange}
          />
        </div>
      </div>
    </SectionCard>

    <SectionCard title="Data Management">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Delete All Chats
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Permanently delete all chat history. This action cannot be undone.
          </p>
        </div>
        <Button
          type="button"
          onClick={onDeleteAllChats}
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          Delete All
        </Button>
      </div>
    </SectionCard>
  </div>
);
