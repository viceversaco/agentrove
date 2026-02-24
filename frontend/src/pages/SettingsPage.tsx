import { useState, useMemo, useCallback, useEffect, useRef, Suspense, lazy } from 'react';
import {
  AlertCircle,
  Settings2,
  Layers,
  Link2,
  Store,
  Plug,
  Bot,
  Zap,
  Terminal,
  MessageSquare,
  Key,
  ScrollText,
  CalendarClock,
  ChevronLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useNavigate } from 'react-router-dom';
import type { UserSettings, UserSettingsUpdate, SandboxProviderType } from '@/types/user.types';
import type { ApiFieldKey } from '@/types/settings.types';
import { useDeleteAllChatsMutation } from '@/hooks/queries/useChatQueries';
import { useSettingsQuery, useUpdateSettingsMutation } from '@/hooks/queries/useSettingsQueries';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import toast from 'react-hot-toast';
import { GeneralSettingsTab } from '@/components/settings/tabs/GeneralSettingsTab';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { getGeneralSecretFields } from '@/utils/settings';

import { ProvidersSection } from '@/components/settings/sections/ProvidersSection';
import { McpSection } from '@/components/settings/sections/McpSection';
import { AgentsSection } from '@/components/settings/sections/AgentsSection';
import { SkillsSection } from '@/components/settings/sections/SkillsSection';
import { CommandsSection } from '@/components/settings/sections/CommandsSection';
import { PromptsSection } from '@/components/settings/sections/PromptsSection';
import { EnvVarsSection } from '@/components/settings/sections/EnvVarsSection';
import { TasksSection } from '@/components/settings/sections/TasksSection';

const IntegrationsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/IntegrationsSettingsTab').then((m) => ({
    default: m.IntegrationsSettingsTab,
  })),
);
const MarketplaceSettingsTab = lazy(() =>
  import('@/components/settings/tabs/MarketplaceSettingsTab').then((m) => ({
    default: m.MarketplaceSettingsTab,
  })),
);
const InstructionsSettingsTab = lazy(() =>
  import('@/components/settings/tabs/InstructionsSettingsTab').then((m) => ({
    default: m.InstructionsSettingsTab,
  })),
);

type TabKey =
  | 'general'
  | 'providers'
  | 'integrations'
  | 'marketplace'
  | 'mcp'
  | 'agents'
  | 'skills'
  | 'commands'
  | 'prompts'
  | 'env_vars'
  | 'instructions'
  | 'tasks';

const getErrorMessage = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

const createFallbackSettings = (): UserSettings => ({
  id: '',
  user_id: '',
  github_personal_access_token: null,
  sandbox_provider: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  custom_instructions: null,
  custom_providers: null,
  custom_agents: null,
  custom_mcps: null,
  custom_env_vars: null,
  custom_skills: null,
  custom_slash_commands: null,
  custom_prompts: null,
  notification_sound_enabled: true,
  auto_compact_disabled: false,
  attribution_disabled: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const TAB_FIELDS: Record<TabKey, (keyof UserSettings)[]> = {
  general: ['github_personal_access_token', 'timezone'],
  providers: ['custom_providers'],
  integrations: [],
  marketplace: [],
  mcp: ['custom_mcps'],
  agents: ['custom_agents'],
  skills: ['custom_skills'],
  commands: ['custom_slash_commands'],
  prompts: ['custom_prompts'],
  env_vars: ['custom_env_vars'],
  instructions: ['custom_instructions'],
  tasks: [],
};

interface SettingsNavItem {
  id: TabKey;
  label: string;
  icon: LucideIcon;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: 'Account',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'providers', label: 'Providers', icon: Layers },
      { id: 'integrations', label: 'Integrations', icon: Link2 },
      { id: 'marketplace', label: 'Marketplace', icon: Store },
    ],
  },
  {
    label: 'Extensions',
    items: [
      { id: 'mcp', label: 'MCP Servers', icon: Plug },
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'skills', label: 'Skills', icon: Zap },
      { id: 'commands', label: 'Commands', icon: Terminal },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { id: 'prompts', label: 'Prompts', icon: MessageSquare },
      { id: 'env_vars', label: 'Env Variables', icon: Key },
      { id: 'instructions', label: 'Instructions', icon: ScrollText },
      { id: 'tasks', label: 'Tasks', icon: CalendarClock },
    ],
  },
];

const TAB_LABELS: Record<TabKey, string> = Object.fromEntries(
  SETTINGS_NAV.flatMap((g) => g.items).map((item) => [item.id, item.label]),
) as Record<TabKey, string>;

const tabLoadingFallback = (
  <div className="flex items-center justify-center py-12">
    <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
  </div>
);

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const generalSecretFields = getGeneralSecretFields();

  const { data: settings, isLoading: loading, error: fetchError } = useSettingsQuery();
  const deleteAllChats = useDeleteAllChatsMutation();

  const [localSettings, setLocalSettings] = useState<UserSettings>(
    () => settings ?? createFallbackSettings(),
  );
  const localSettingsRef = useRef<UserSettings>(localSettings);

  const manualUpdateMutation = useUpdateSettingsMutation({
    onSuccess: (data) => {
      toast.success('Settings saved successfully');
      setLocalSettings(data);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) || 'Failed to save settings');
    },
  });

  const instantUpdateMutation = useUpdateSettingsMutation();

  useEffect(() => {
    localSettingsRef.current = localSettings;
  }, [localSettings]);

  const buildChangedPayload = useCallback(
    (current: UserSettings, previous: UserSettings): UserSettingsUpdate => {
      const payload: UserSettingsUpdate = {};
      const fields: (keyof UserSettingsUpdate)[] = [
        'github_personal_access_token',
        'sandbox_provider',
        'timezone',
        'custom_instructions',
        'custom_providers',
        'custom_agents',
        'custom_mcps',
        'custom_env_vars',
        'custom_skills',
        'custom_slash_commands',
        'custom_prompts',
        'notification_sound_enabled',
        'auto_compact_disabled',
        'attribution_disabled',
      ];

      for (const field of fields) {
        if (JSON.stringify(current[field]) !== JSON.stringify(previous[field])) {
          payload[field] = (current[field] ?? null) as UserSettingsUpdate[typeof field];
        }
      }
      return payload;
    },
    [],
  );

  const persistSettings = useCallback(
    async (
      updater: (previous: UserSettings) => UserSettings,
      options: { successMessage?: string; errorMessage?: string } = {},
    ) => {
      const previousSettings = localSettingsRef.current ?? createFallbackSettings();
      const updatedSettings = updater(previousSettings);

      setLocalSettings(updatedSettings);
      localSettingsRef.current = updatedSettings;

      try {
        const payload = buildChangedPayload(updatedSettings, previousSettings);
        if (Object.keys(payload).length === 0) return;

        const result = await instantUpdateMutation.mutateAsync(payload);
        setLocalSettings(result);
        localSettingsRef.current = result;
        if (options.successMessage) {
          toast.success(options.successMessage);
        }
      } catch (error) {
        setLocalSettings(previousSettings);
        localSettingsRef.current = previousSettings;
        toast.error(options.errorMessage || getErrorMessage(error) || 'Failed to update settings');
        throw error;
      }
    },
    [instantUpdateMutation, buildChangedPayload],
  );

  const [revealedFields, setRevealedFields] = useState<Record<ApiFieldKey, boolean>>({
    github_personal_access_token: false,
  });

  const hasUnsavedChanges = useMemo(() => {
    if (!settings) return false;
    if (activeTab !== 'general' && activeTab !== 'instructions') return false;

    const changedPayload = buildChangedPayload(localSettings, settings);
    const currentTabFields = TAB_FIELDS[activeTab] ?? [];

    return currentTabFields.some((field) => field in changedPayload);
  }, [localSettings, settings, activeTab, buildChangedPayload]);

  const handleCancel = () => {
    if (settings) {
      setLocalSettings({ ...settings });
      toast.success('Changes discarded');
    }
  };

  const handleSave = () => {
    const payload = buildChangedPayload(localSettings, settings ?? createFallbackSettings());
    if (Object.keys(payload).length === 0) {
      toast.success('No changes to save');
      return;
    }
    manualUpdateMutation.mutate(payload);
  };

  const handleInputChange = <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSecretFieldChange = (field: ApiFieldKey, value: string) => {
    handleInputChange(field, value);
  };

  const toggleFieldVisibility = (field: ApiFieldKey) => {
    setRevealedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleDeleteAllChats = () => {
    setIsDeleteAllDialogOpen(true);
  };

  const handleNotificationSoundChange = (enabled: boolean) => {
    persistSettings((prev) => ({ ...prev, notification_sound_enabled: enabled }));
  };

  const handleAutoCompactDisabledChange = (disabled: boolean) => {
    persistSettings((prev) => ({ ...prev, auto_compact_disabled: disabled }));
  };

  const handleAttributionDisabledChange = (disabled: boolean) => {
    persistSettings((prev) => ({ ...prev, attribution_disabled: disabled }));
  };

  const handleSandboxProviderChange = (provider: SandboxProviderType) => {
    persistSettings((prev) => ({ ...prev, sandbox_provider: provider }));
  };

  const handleTimezoneChange = (timezone: string) => {
    handleInputChange('timezone', timezone);
  };

  const confirmDeleteAllChats = async () => {
    try {
      await deleteAllChats.mutateAsync();
      toast.success('All chats deleted successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete all chats');
    } finally {
      setIsDeleteAllDialogOpen(false);
    }
  };

  useEffect(() => {
    if (settings) {
      setLocalSettings({ ...settings });
    }
  }, [settings]);

  const errorMessage =
    getErrorMessage(fetchError) ?? getErrorMessage(manualUpdateMutation.error) ?? null;

  const handleTabChange = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-viewport flex items-center justify-center bg-surface dark:bg-surface-dark">
        <Spinner size="lg" className="text-text-quaternary dark:text-text-dark-quaternary" />
      </div>
    );
  }

  if (fetchError && !settings) {
    return (
      <div className="min-h-viewport flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="text-text-primary dark:text-text-dark-primary">Failed to load settings</div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-surface dark:bg-surface-dark">
      {/* Vertical settings navigation — desktop */}
      <nav
        className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary md:flex"
        aria-label="Settings sections"
      >
        <div className="border-b border-border px-5 py-4 dark:border-border-dark">
          <Button
            onClick={() => navigate('/')}
            variant="unstyled"
            className="group flex items-center gap-1.5 text-xs text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
          >
            <ChevronLeft className="h-3 w-3 transition-transform duration-200 group-hover:-translate-x-0.5" />
            Back
          </Button>
          <h1 className="mt-3 text-sm font-semibold text-text-primary dark:text-text-dark-primary">
            Settings
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {SETTINGS_NAV.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="px-2 pb-1 pt-3">
                <span className="text-2xs font-medium uppercase tracking-widest text-text-quaternary dark:text-text-dark-quaternary">
                  {group.label}
                </span>
              </div>
              <div className="space-y-px">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <Button
                      key={item.id}
                      onClick={() => handleTabChange(item.id)}
                      variant="unstyled"
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-200',
                        isActive
                          ? 'bg-surface-hover font-medium text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
                          : 'text-text-tertiary hover:bg-surface-hover/50 hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50 dark:hover:text-text-dark-secondary',
                      )}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`${item.id}-panel`}
                      id={`${item.id}-tab`}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0 transition-colors duration-200',
                          isActive
                            ? 'text-text-secondary dark:text-text-dark-secondary'
                            : 'text-text-quaternary dark:text-text-dark-quaternary',
                        )}
                      />
                      {item.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile top bar for settings nav */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 dark:border-border-dark md:hidden">
          <Button
            onClick={() => navigate('/')}
            variant="unstyled"
            className="p-1 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
            aria-label="Go back"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            variant="unstyled"
            className="flex items-center gap-2 text-xs font-medium text-text-primary dark:text-text-dark-primary"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileNavOpen}
          >
            {TAB_LABELS[activeTab]}
            <svg
              className={cn(
                'h-3 w-3 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
                mobileNavOpen && 'rotate-180',
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </Button>
        </div>

        {/* Mobile dropdown nav */}
        {mobileNavOpen && (
          <div className="animate-in fade-in border-b border-border bg-surface px-3 py-2 duration-150 dark:border-border-dark dark:bg-surface-dark md:hidden">
            {SETTINGS_NAV.map((group) => (
              <div key={group.label} className="mb-1">
                <div className="px-2 pb-1 pt-2">
                  <span className="text-2xs font-medium uppercase tracking-widest text-text-quaternary dark:text-text-dark-quaternary">
                    {group.label}
                  </span>
                </div>
                <div className="space-y-px">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <Button
                        key={item.id}
                        onClick={() => handleTabChange(item.id)}
                        variant="unstyled"
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors duration-200',
                          isActive
                            ? 'bg-surface-hover font-medium text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
                            : 'text-text-tertiary hover:bg-surface-hover/50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            isActive
                              ? 'text-text-secondary dark:text-text-dark-secondary'
                              : 'text-text-quaternary dark:text-text-dark-quaternary',
                          )}
                        />
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
            {hasUnsavedChanges && (
              <div className="animate-in fade-in slide-in-from-top-2 mb-5 flex flex-col gap-3 rounded-xl border border-border p-4 duration-300 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between sm:gap-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary dark:bg-surface-dark-tertiary">
                    <AlertCircle className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
                  </div>
                  <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    You have unsaved changes
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handleCancel}
                    variant="outline"
                    size="sm"
                    className="flex-1 text-text-secondary dark:text-text-dark-secondary sm:flex-none"
                  >
                    Discard
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    variant="primary"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    isLoading={manualUpdateMutation.isPending}
                    loadingText="Saving..."
                  >
                    Save Changes
                  </Button>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="mb-5 rounded-xl border border-border p-3 dark:border-border-dark">
                <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  {errorMessage}
                </p>
              </div>
            )}

            <SettingsProvider
              localSettings={localSettings}
              setLocalSettings={setLocalSettings}
              persistSettings={persistSettings}
              settings={settings}
            >
              <ErrorBoundary>
                <div className="min-w-0 space-y-6">
                  {activeTab === 'general' && (
                    <div role="tabpanel" id="general-panel" aria-labelledby="general-tab">
                      <GeneralSettingsTab
                        fields={generalSecretFields}
                        settings={localSettings}
                        revealedFields={revealedFields}
                        onSecretChange={handleSecretFieldChange}
                        onToggleVisibility={toggleFieldVisibility}
                        onDeleteAllChats={handleDeleteAllChats}
                        onNotificationSoundChange={handleNotificationSoundChange}
                        onAutoCompactDisabledChange={handleAutoCompactDisabledChange}
                        onAttributionDisabledChange={handleAttributionDisabledChange}
                        onSandboxProviderChange={handleSandboxProviderChange}
                        onTimezoneChange={handleTimezoneChange}
                      />
                    </div>
                  )}

                  {activeTab === 'providers' && (
                    <div role="tabpanel" id="providers-panel" aria-labelledby="providers-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <ProvidersSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'integrations' && (
                    <div role="tabpanel" id="integrations-panel" aria-labelledby="integrations-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <IntegrationsSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'marketplace' && (
                    <div role="tabpanel" id="marketplace-panel" aria-labelledby="marketplace-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <MarketplaceSettingsTab />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'mcp' && (
                    <div role="tabpanel" id="mcp-panel" aria-labelledby="mcp-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <McpSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'agents' && (
                    <div role="tabpanel" id="agents-panel" aria-labelledby="agents-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <AgentsSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'skills' && (
                    <div role="tabpanel" id="skills-panel" aria-labelledby="skills-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <SkillsSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'commands' && (
                    <div role="tabpanel" id="commands-panel" aria-labelledby="commands-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <CommandsSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'prompts' && (
                    <div role="tabpanel" id="prompts-panel" aria-labelledby="prompts-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <PromptsSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'env_vars' && (
                    <div role="tabpanel" id="env_vars-panel" aria-labelledby="env_vars-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <EnvVarsSection />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'instructions' && (
                    <div role="tabpanel" id="instructions-panel" aria-labelledby="instructions-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <InstructionsSettingsTab
                          instructions={localSettings.custom_instructions || ''}
                          onInstructionsChange={(value) =>
                            handleInputChange('custom_instructions', value)
                          }
                        />
                      </Suspense>
                    </div>
                  )}

                  {activeTab === 'tasks' && (
                    <div role="tabpanel" id="tasks-panel" aria-labelledby="tasks-tab">
                      <Suspense fallback={tabLoadingFallback}>
                        <TasksSection isActive={activeTab === 'tasks'} />
                      </Suspense>
                    </div>
                  )}
                </div>
              </ErrorBoundary>
            </SettingsProvider>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isDeleteAllDialogOpen}
        onClose={() => setIsDeleteAllDialogOpen(false)}
        onConfirm={confirmDeleteAllChats}
        title="Delete All Chats"
        message="Are you sure you want to delete all chats? This action cannot be undone."
        confirmLabel="Delete All"
        cancelLabel="Cancel"
      />
    </div>
  );
};

export default SettingsPage;
