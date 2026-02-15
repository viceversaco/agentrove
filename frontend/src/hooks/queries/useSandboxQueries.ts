import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { sandboxService } from '@/services/sandboxService';
import type {
  FileContent,
  FileMetadata,
  PortInfo,
  Secret,
  UpdateFileResult,
} from '@/types/sandbox.types';
import { queryKeys } from './queryKeys';

export const usePreviewLinksQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<PortInfo[]>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.previewLinks(sandboxId),
    queryFn: () => sandboxService.getPreviewLinks(sandboxId),
    enabled: !!sandboxId,
    ...options,
  });
};

export const useIDEUrlQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<string | null>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.ideUrl(sandboxId),
    queryFn: () => sandboxService.getIDEUrl(sandboxId),
    enabled: !!sandboxId,
    ...options,
  });
};

export const useFileContentQuery = (
  sandboxId: string,
  filePath: string,
  options?: Partial<UseQueryOptions<FileContent>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
    queryFn: () => sandboxService.getFileContent(sandboxId, filePath),
    enabled: !!sandboxId && !!filePath,
    ...options,
  });
};

export const useFilesMetadataQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<FileMetadata[]>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.filesMetadata(sandboxId),
    queryFn: () => sandboxService.getSandboxFilesMetadata(sandboxId),
    enabled: !!sandboxId,
    ...options,
  });
};

export const useSecretsQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<Secret[]>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.secrets(sandboxId),
    queryFn: () => sandboxService.getSecrets(sandboxId),
    enabled: !!sandboxId,
    ...options,
  });
};

interface UpdateFileParams {
  sandboxId: string;
  filePath: string;
  content: string;
}

export const useUpdateFileMutation = (
  options?: UseMutationOptions<UpdateFileResult, Error, UpdateFileParams>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ sandboxId, filePath, content }) =>
      sandboxService.updateFile(sandboxId, filePath, content),
    onSuccess: async (data, variables, context, mutation) => {
      const { sandboxId, filePath } = variables;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.fileContent(sandboxId, filePath),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.filesMetadata(sandboxId),
        }),
      ]);
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

type SecretMutationVariables = { sandboxId: string; key: string; value?: string };

const useSecretMutation = <TVariables extends { sandboxId: string }>(
  mutationFn: (variables: TVariables) => Promise<void>,
  options?: UseMutationOptions<void, Error, TVariables>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn,
    onSuccess: async (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sandbox.secrets(variables.sandboxId) });
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useAddSecretMutation = (
  options?: UseMutationOptions<void, Error, SecretMutationVariables>,
) =>
  useSecretMutation(
    ({ sandboxId, key, value }) => sandboxService.addSecret(sandboxId, key, value!),
    options,
  );

export const useUpdateSecretMutation = (
  options?: UseMutationOptions<void, Error, SecretMutationVariables>,
) =>
  useSecretMutation(
    ({ sandboxId, key, value }) => sandboxService.updateSecret(sandboxId, key, value!),
    options,
  );

export const useDeleteSecretMutation = (
  options?: UseMutationOptions<void, Error, { sandboxId: string; key: string }>,
) =>
  useSecretMutation(({ sandboxId, key }) => sandboxService.deleteSecret(sandboxId, key), options);

interface BrowserStatus {
  running: boolean;
  current_url?: string;
}

export const useVNCUrlQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<string | null>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.vncUrl(sandboxId),
    queryFn: () => sandboxService.getVNCUrl(sandboxId),
    enabled: !!sandboxId,
    ...options,
  });
};

export const useBrowserStatusQuery = (
  sandboxId: string,
  options?: Partial<UseQueryOptions<BrowserStatus>>,
) => {
  return useQuery({
    queryKey: queryKeys.sandbox.browserStatus(sandboxId),
    queryFn: () => sandboxService.getBrowserStatus(sandboxId),
    enabled: !!sandboxId,
    refetchInterval: 5000,
    ...options,
  });
};

interface StartBrowserParams {
  sandboxId: string;
  url?: string;
}

export const useStartBrowserMutation = (
  options?: UseMutationOptions<BrowserStatus, Error, StartBrowserParams>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ sandboxId, url }) => sandboxService.startBrowser(sandboxId, url),
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.browserStatus(variables.sandboxId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.vncUrl(variables.sandboxId),
        }),
      ]);
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useStopBrowserMutation = (
  options?: UseMutationOptions<void, Error, { sandboxId: string }>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ sandboxId }) => sandboxService.stopBrowser(sandboxId),
    onSuccess: async (data, variables, context, mutation) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sandbox.browserStatus(variables.sandboxId),
      });
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};
