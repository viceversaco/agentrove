import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import { queryKeys } from './queryKeys';

export const useSettingsQuery = (options?: Partial<UseQueryOptions<UserSettings>>) => {
  return useQuery({
    queryKey: [queryKeys.settings],
    queryFn: () => settingsService.getSettings(),
    ...options,
  });
};

export const useUpdateSettingsMutation = (
  options?: UseMutationOptions<UserSettings, Error, UserSettingsUpdate>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: UserSettingsUpdate) => settingsService.updateSettings(data),
    onSuccess: async (data, variables, context, mutation) => {
      queryClient.setQueryData([queryKeys.settings], data);
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};
