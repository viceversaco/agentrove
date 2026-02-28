import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { workspaceService } from '@/services/workspaceService';
import type {
  Workspace,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { PaginatedResponse } from '@/types/api.types';
import { queryKeys } from './queryKeys';

export const useWorkspacesQuery = (
  options?: Partial<UseQueryOptions<PaginatedResponse<Workspace>>>,
) => {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => workspaceService.listWorkspaces(),
    ...options,
  });
};

export const useCreateWorkspaceMutation = (
  options?: UseMutationOptions<Workspace, Error, CreateWorkspaceRequest>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: CreateWorkspaceRequest) => workspaceService.createWorkspace(data),
    onSuccess: async (newWorkspace, variables, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });

      if (onSuccess) {
        await onSuccess(newWorkspace, variables, context);
      }
    },
    ...restOptions,
  });
};

export const useUpdateWorkspaceMutation = (
  options?: UseMutationOptions<
    Workspace,
    Error,
    { workspaceId: string; data: UpdateWorkspaceRequest }
  >,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ workspaceId, data }) => workspaceService.updateWorkspace(workspaceId, data),
    onSuccess: async (updatedWorkspace, variables, context) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });

      if (onSuccess) {
        await onSuccess(updatedWorkspace, variables, context);
      }
    },
    ...restOptions,
  });
};

export const useDeleteWorkspaceMutation = (options?: UseMutationOptions<void, Error, string>) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (workspaceId: string) => workspaceService.deleteWorkspace(workspaceId),
    onSuccess: async (data, workspaceId, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
        queryClient.invalidateQueries({ queryKey: [queryKeys.chats] }),
      ]);

      if (onSuccess) {
        await onSuccess(data, workspaceId, context);
      }
    },
    ...restOptions,
  });
};
