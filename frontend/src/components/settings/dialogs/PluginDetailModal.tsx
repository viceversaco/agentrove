import { useState, useEffect, useMemo } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import { Bot, Terminal, Zap, Plug, ExternalLink, X, AlertCircle } from 'lucide-react';
import {
  usePluginDetailsQuery,
  useInstallComponentsMutation,
  useUninstallComponentsMutation,
  useInstalledPluginsQuery,
} from '@/hooks/queries/useMarketplaceQueries';
import type { MarketplacePlugin } from '@/types/marketplace.types';
import toast from 'react-hot-toast';

interface PluginDetailModalProps {
  plugin: MarketplacePlugin | null;
  isOpen: boolean;
  onClose: () => void;
}

const COMPONENT_ICONS = {
  agent: Bot,
  command: Terminal,
  skill: Zap,
  mcp: Plug,
} as const;

type ComponentType = keyof typeof COMPONENT_ICONS;

interface ComponentEntry {
  type: ComponentType;
  name: string;
}

function InstalledComponentRow({
  comp,
  componentId,
  isSelectedForUninstall,
  onToggle,
  readOnly,
}: {
  comp: ComponentEntry;
  componentId: string;
  isSelectedForUninstall: boolean;
  onToggle: (id: string) => void;
  readOnly?: boolean;
}) {
  const Icon = COMPONENT_ICONS[comp.type];

  return (
    <label
      className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
        readOnly
          ? 'border-border/50 bg-surface-active dark:border-border-dark/50 dark:bg-surface-dark-active'
          : isSelectedForUninstall
            ? 'cursor-pointer border-border-hover bg-surface-hover dark:border-border-dark-hover dark:bg-surface-dark-hover'
            : 'cursor-pointer border-border/50 bg-surface-active dark:border-border-dark/50 dark:bg-surface-dark-active'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon
          className={`h-4 w-4 ${
            isSelectedForUninstall && !readOnly
              ? 'text-text-tertiary dark:text-text-dark-tertiary'
              : 'text-text-secondary dark:text-text-dark-secondary'
          }`}
        />
        <div>
          <span className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            {comp.name}
          </span>
          <span className="ml-2 text-xs capitalize text-text-tertiary dark:text-text-dark-tertiary">
            {comp.type}
          </span>
          {readOnly && (
            <span className="ml-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              installed via CLI
            </span>
          )}
        </div>
      </div>
      {!readOnly && (
        <input
          type="checkbox"
          checked={isSelectedForUninstall}
          onChange={() => onToggle(componentId)}
          className="h-4 w-4 rounded border-border text-text-primary accent-text-primary focus:ring-text-quaternary/30 dark:border-border-dark"
        />
      )}
    </label>
  );
}

function AvailableComponentRow({
  comp,
  componentId,
  isSelected,
  onToggle,
}: {
  comp: ComponentEntry;
  componentId: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
}) {
  const Icon = COMPONENT_ICONS[comp.type];

  return (
    <label
      className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 transition-colors ${
        isSelected
          ? 'border-border-hover bg-surface-active dark:border-border-dark-hover dark:bg-surface-dark-active'
          : 'border-border hover:border-border-hover dark:border-border-dark dark:hover:border-border-dark-hover'
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
        <div>
          <span className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            {comp.name}
          </span>
          <span className="ml-2 text-xs capitalize text-text-tertiary dark:text-text-dark-tertiary">
            {comp.type}
          </span>
        </div>
      </div>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(componentId)}
        className="h-4 w-4 rounded border-border text-text-primary accent-text-primary focus:ring-text-quaternary/30 dark:border-border-dark"
      />
    </label>
  );
}

function PluginModalHeader({
  plugin,
  onClose,
}: {
  plugin: MarketplacePlugin;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-surface-tertiary p-4 dark:border-border-dark dark:bg-surface-dark-tertiary">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-text-primary dark:text-text-dark-primary">
            {plugin.name}
          </h2>
          {plugin.version && (
            <span className="rounded bg-surface-tertiary px-2 py-0.5 text-xs dark:bg-surface-dark-tertiary">
              v{plugin.version}
            </span>
          )}
        </div>
        {plugin.author?.name && (
          <p className="mt-0.5 text-sm text-text-secondary dark:text-text-dark-secondary">
            by {plugin.author.name}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {plugin.homepage && (
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit homepage"
            className="rounded p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded p-1.5 text-text-tertiary hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export const PluginDetailModal: React.FC<PluginDetailModalProps> = ({
  plugin,
  isOpen,
  onClose,
}) => {
  const [selectedComponents, setSelectedComponents] = useState<Set<string>>(() => new Set());
  const [selectedForUninstall, setSelectedForUninstall] = useState<Set<string>>(() => new Set());

  const {
    data: details,
    isLoading,
    isError,
    error,
  } = usePluginDetailsQuery(isOpen ? (plugin?.name ?? null) : null);
  const { data: installedPlugins = [] } = useInstalledPluginsQuery();
  const installMutation = useInstallComponentsMutation();
  const uninstallMutation = useUninstallComponentsMutation();

  const installedPlugin = installedPlugins.find((p) => p.name === plugin?.name);
  const cliInstalledWithoutComponents =
    installedPlugin !== undefined && (installedPlugin.components ?? []).length === 0;
  const installedComponents = useMemo(
    () => new Set(installedPlugin?.components ?? []),
    [installedPlugin?.components],
  );

  useEffect(() => {
    if (!isOpen) {
      setSelectedComponents(new Set());
      setSelectedForUninstall(new Set());
    }
  }, [isOpen]);

  if (!plugin) return null;

  const allComponents: ComponentEntry[] = details
    ? [
        ...details.components.agents.map((name) => ({ type: 'agent' as const, name })),
        ...details.components.commands.map((name) => ({ type: 'command' as const, name })),
        ...details.components.skills.map((name) => ({ type: 'skill' as const, name })),
        ...details.components.mcp_servers.map((name) => ({ type: 'mcp' as const, name })),
      ]
    : [];

  const toggleComponent = (componentId: string) => {
    const newSelected = new Set(selectedComponents);
    if (newSelected.has(componentId)) {
      newSelected.delete(componentId);
    } else {
      newSelected.add(componentId);
    }
    setSelectedComponents(newSelected);
  };

  const toggleUninstall = (componentId: string) => {
    const newSelected = new Set(selectedForUninstall);
    if (newSelected.has(componentId)) {
      newSelected.delete(componentId);
    } else {
      newSelected.add(componentId);
    }
    setSelectedForUninstall(newSelected);
  };

  const isComponentInstalled = (c: ComponentEntry) =>
    cliInstalledWithoutComponents || installedComponents.has(`${c.type}:${c.name}`);

  const selectAll = () => {
    const notInstalled = allComponents
      .filter((c) => !isComponentInstalled(c))
      .map((c) => `${c.type}:${c.name}`);
    setSelectedComponents(new Set(notInstalled));
  };

  const selectAllForUninstall = () => {
    const installed = allComponents.filter(isComponentInstalled).map((c) => `${c.type}:${c.name}`);
    setSelectedForUninstall(new Set(installed));
  };

  const hasUninstalledComponents = allComponents.some((c) => !isComponentInstalled(c));
  const hasInstalledComponents = allComponents.some(isComponentInstalled);

  const handleInstall = async () => {
    if (selectedComponents.size === 0) {
      toast.error('Select at least one component to install');
      return;
    }

    try {
      const result = await installMutation.mutateAsync({
        plugin_name: plugin.name,
        components: Array.from(selectedComponents),
      });

      if (result.installed.length > 0) {
        toast.success(`Installed ${result.installed.length} component(s)`);
      }
      if (result.failed.length > 0) {
        const errorMessages = result.failed
          .map((f) => f.error || 'Unknown error')
          .filter((e) => e)
          .join(', ');
        toast.error(`Failed: ${errorMessages || 'Installation failed'}`);
      }
      if (result.installed.length > 0) {
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Installation failed');
    }
  };

  const handleUninstall = async () => {
    if (selectedForUninstall.size === 0) {
      toast.error('Select at least one component to uninstall');
      return;
    }

    try {
      const result = await uninstallMutation.mutateAsync({
        plugin_name: plugin.name,
        components: Array.from(selectedForUninstall),
      });

      if (result.uninstalled.length > 0) {
        toast.success(`Uninstalled ${result.uninstalled.length} component(s)`);
        setSelectedForUninstall(new Set());
      }
      if (result.failed.length > 0) {
        const errorMessages = result.failed
          .map((f) => f.error || 'Unknown error')
          .filter((e) => e)
          .join(', ');
        toast.error(`Failed: ${errorMessages || 'Uninstallation failed'}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Uninstallation failed');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="flex max-h-[80vh] flex-col">
        <PluginModalHeader plugin={plugin} onClose={onClose} />

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-4 text-sm text-text-secondary dark:text-text-dark-secondary">
            {plugin.description}
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" className="text-text-quaternary dark:text-text-dark-quaternary" />
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-error-200 bg-error-50 p-6 text-center dark:border-error-800 dark:bg-error-900/20">
              <AlertCircle className="mx-auto mb-3 h-6 w-6 text-error-500 dark:text-error-400" />
              <p className="mb-1 text-sm font-medium text-error-700 dark:text-error-300">
                Failed to load plugin details
              </p>
              <p className="text-xs text-error-600 dark:text-error-400">
                {error instanceof Error ? error.message : 'An error occurred'}
              </p>
            </div>
          ) : details && allComponents.length > 0 ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
                  Components
                </h3>
                <div className="flex gap-3">
                  {hasInstalledComponents && !cliInstalledWithoutComponents && (
                    <button
                      onClick={selectAllForUninstall}
                      className="text-xs text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                    >
                      Select all installed
                    </button>
                  )}
                  {hasUninstalledComponents && (
                    <button
                      onClick={selectAll}
                      className="text-xs text-text-primary underline hover:text-text-secondary dark:text-text-dark-primary dark:hover:text-text-dark-secondary"
                    >
                      Select all available
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-4 space-y-2">
                {allComponents.map((comp) => {
                  const componentId = `${comp.type}:${comp.name}`;
                  const isInstalled = isComponentInstalled(comp);

                  return isInstalled ? (
                    <InstalledComponentRow
                      key={componentId}
                      comp={comp}
                      componentId={componentId}
                      isSelectedForUninstall={selectedForUninstall.has(componentId)}
                      onToggle={toggleUninstall}
                      readOnly={cliInstalledWithoutComponents}
                    />
                  ) : (
                    <AvailableComponentRow
                      key={componentId}
                      comp={comp}
                      componentId={componentId}
                      isSelected={selectedComponents.has(componentId)}
                      onToggle={toggleComponent}
                    />
                  );
                })}
              </div>

              {details.readme && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-medium text-text-primary dark:text-text-dark-primary">
                    Documentation
                  </h3>
                  <div className="max-h-64 overflow-y-auto rounded-lg bg-surface-tertiary p-3 dark:bg-surface-dark-tertiary">
                    <LazyMarkDown content={details.readme} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="py-4 text-center text-sm text-text-tertiary dark:text-text-dark-tertiary">
              No components available
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border bg-surface-tertiary p-4 dark:border-border-dark dark:bg-surface-dark-tertiary">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {selectedForUninstall.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleUninstall}
              disabled={uninstallMutation.isPending}
              isLoading={uninstallMutation.isPending}
            >
              Uninstall ({selectedForUninstall.size})
            </Button>
          )}
          {selectedComponents.size > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInstall}
              disabled={installMutation.isPending || isError}
              isLoading={installMutation.isPending}
            >
              Install ({selectedComponents.size})
            </Button>
          )}
        </div>
      </div>
    </BaseModal>
  );
};
