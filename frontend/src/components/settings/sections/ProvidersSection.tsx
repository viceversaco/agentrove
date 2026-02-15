import { useState, useCallback, Suspense, lazy } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { CustomProvider } from '@/types/user.types';

const ProvidersSettingsTab = lazy(() =>
  import('@/components/settings/tabs/ProvidersSettingsTab').then((m) => ({
    default: m.ProvidersSettingsTab,
  })),
);
const ProviderDialog = lazy(() =>
  import('@/components/settings/dialogs/ProviderDialog').then((m) => ({
    default: m.ProviderDialog,
  })),
);

export function ProvidersSection() {
  const { localSettings, persistSettings } = useSettingsContext();
  const queryClient = useQueryClient();

  const [isProviderDialogOpen, setIsProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<CustomProvider | null>(null);

  const handleAddProvider = useCallback(() => {
    setEditingProvider(null);
    setIsProviderDialogOpen(true);
  }, []);

  const handleEditProvider = useCallback((provider: CustomProvider) => {
    setEditingProvider(provider);
    setIsProviderDialogOpen(true);
  }, []);

  const handleDeleteProvider = useCallback(
    (providerId: string) => {
      void persistSettings(
        (prev) => ({
          ...prev,
          custom_providers: (prev.custom_providers || []).filter((p) => p.id !== providerId),
        }),
        { successMessage: 'Provider deleted' },
      ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
    },
    [persistSettings, queryClient],
  );

  const handleToggleProvider = useCallback(
    (providerId: string, enabled: boolean) => {
      void persistSettings((prev) => ({
        ...prev,
        custom_providers: (prev.custom_providers || []).map((p) =>
          p.id === providerId ? { ...p, enabled } : p,
        ),
      })).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
    },
    [persistSettings, queryClient],
  );

  const handleSaveProvider = useCallback(
    (provider: CustomProvider) => {
      const providers = localSettings.custom_providers || [];
      const existingIndex = providers.findIndex((p) => p.id === provider.id);

      if (existingIndex >= 0) {
        void persistSettings(
          (prev) => ({
            ...prev,
            custom_providers: (prev.custom_providers || []).map((p) =>
              p.id === provider.id ? provider : p,
            ),
          }),
          { successMessage: 'Provider updated' },
        ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
      } else {
        void persistSettings(
          (prev) => ({
            ...prev,
            custom_providers: [...(prev.custom_providers || []), provider],
          }),
          { successMessage: 'Provider added' },
        ).then(() => queryClient.invalidateQueries({ queryKey: [queryKeys.models] }));
      }
      setIsProviderDialogOpen(false);
      setEditingProvider(null);
    },
    [localSettings.custom_providers, persistSettings, queryClient],
  );

  const handleProviderDialogClose = useCallback(() => {
    setIsProviderDialogOpen(false);
    setEditingProvider(null);
  }, []);

  return (
    <>
      <ProvidersSettingsTab
        providers={localSettings.custom_providers ?? null}
        onAddProvider={handleAddProvider}
        onEditProvider={handleEditProvider}
        onDeleteProvider={handleDeleteProvider}
        onToggleProvider={handleToggleProvider}
      />
      {isProviderDialogOpen && (
        <Suspense fallback={null}>
          <ProviderDialog
            isOpen={isProviderDialogOpen}
            provider={editingProvider}
            onClose={handleProviderDialogClose}
            onSave={handleSaveProvider}
          />
        </Suspense>
      )}
    </>
  );
}
