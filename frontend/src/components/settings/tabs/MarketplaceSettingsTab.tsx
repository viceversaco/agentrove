import { useState, useMemo, lazy, Suspense } from 'react';
import { Input } from '@/components/ui/primitives/Input';
import { Select } from '@/components/ui/primitives/Select';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { Store, Search, RefreshCw, AlertCircle } from 'lucide-react';
import {
  useMarketplaceCatalogQuery,
  useInstalledPluginsQuery,
  useRefreshCatalogMutation,
} from '@/hooks/queries/useMarketplaceQueries';
import { PluginCard } from './marketplace/PluginCard';
import type { MarketplacePlugin } from '@/types/marketplace.types';

const PluginDetailModal = lazy(() =>
  import('../dialogs/PluginDetailModal').then((m) => ({ default: m.PluginDetailModal })),
);

const CATEGORIES = [
  'all',
  'automation',
  'database',
  'deployment',
  'design',
  'development',
  'learning',
  'location',
  'migration',
  'monitoring',
  'productivity',
  'security',
  'testing',
  'other',
] as const;

export const MarketplaceSettingsTab: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | null>(null);

  const { data: plugins = [], isLoading, isError, error } = useMarketplaceCatalogQuery();
  const { data: installedPlugins = [] } = useInstalledPluginsQuery();
  const refreshMutation = useRefreshCatalogMutation();

  const installedNames = useMemo(
    () => new Set(installedPlugins.map((p) => p.name)),
    [installedPlugins],
  );

  const filteredPlugins = useMemo(() => {
    return plugins.filter((plugin) => {
      const matchesSearch =
        !searchQuery ||
        plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [plugins, searchQuery, selectedCategory]);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Plugin Marketplace
          </h2>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            aria-label="Refresh marketplace"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        <p className="mb-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Browse and install plugins from the official Claude Code marketplace. Plugins can include
          agents, commands, skills, and MCP servers.
        </p>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary dark:text-text-dark-tertiary" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search plugins..."
              className="pl-9"
            />
          </div>
          <div className="w-44 shrink-0">
            <Select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category === 'all'
                    ? 'All Categories'
                    : category.charAt(0).toUpperCase() + category.slice(1)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-border p-6 text-center dark:border-border-dark">
            <AlertCircle className="mx-auto mb-3 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mb-2 text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Failed to load marketplace
            </p>
            <p className="mb-4 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
              {error instanceof Error ? error.message : 'An error occurred while fetching plugins'}
            </p>
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors duration-200 hover:border-border-hover hover:text-text-primary disabled:opacity-50 dark:border-border-dark dark:text-text-dark-secondary dark:hover:border-border-dark-hover dark:hover:text-text-dark-primary"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`}
              />
              Try Again
            </button>
          </div>
        ) : filteredPlugins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center dark:border-border-dark">
            <Store className="mx-auto mb-3 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {plugins.length === 0 ? 'No plugins available' : 'No plugins match your search'}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPlugins.map((plugin) => (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                isInstalled={installedNames.has(plugin.name)}
                onClick={() => setSelectedPlugin(plugin)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedPlugin && (
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          }
        >
          <PluginDetailModal
            plugin={selectedPlugin}
            isOpen={!!selectedPlugin}
            onClose={() => setSelectedPlugin(null)}
          />
        </Suspense>
      )}
    </div>
  );
};
