import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseQueryOptions } from '@tanstack/react-query';
import { schedulerService } from '@/services/schedulerService';
import type {
  ScheduledTask,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  TaskToggleResponse,
} from '@/types/scheduler.types';
import { queryKeys } from './queryKeys';

export const useScheduledTasksQuery = (options?: Partial<UseQueryOptions<ScheduledTask[]>>) => {
  return useQuery({
    queryKey: queryKeys.scheduler.tasks,
    queryFn: () => schedulerService.getTasks(),
    ...options,
  });
};

export const useCreateScheduledTaskMutation = (
  options?: UseMutationOptions<ScheduledTask, Error, CreateScheduledTaskRequest>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (data: CreateScheduledTaskRequest) => schedulerService.createTask(data),
    onSuccess: async (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.tasks });
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

interface UpdateScheduledTaskParams {
  taskId: string;
  data: UpdateScheduledTaskRequest;
}

export const useUpdateScheduledTaskMutation = (
  options?: UseMutationOptions<ScheduledTask, Error, UpdateScheduledTaskParams>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: ({ taskId, data }: UpdateScheduledTaskParams) =>
      schedulerService.updateTask(taskId, data),
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.task(variables.taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.tasks }),
      ]);
      if (onSuccess) {
        await onSuccess(data, variables, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useDeleteScheduledTaskMutation = (
  options?: UseMutationOptions<void, Error, string>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (taskId: string) => schedulerService.deleteTask(taskId),
    onSuccess: async (data, taskId, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.tasks });
      if (onSuccess) {
        await onSuccess(data, taskId, context, mutation);
      }
    },
    ...restOptions,
  });
};

export const useToggleScheduledTaskMutation = (
  options?: UseMutationOptions<TaskToggleResponse, Error, string>,
) => {
  const queryClient = useQueryClient();
  const { onSuccess, ...restOptions } = options ?? {};

  return useMutation({
    mutationFn: (taskId: string) => schedulerService.toggleTask(taskId),
    onSuccess: async (data, taskId, context, mutation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.tasks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduler.task(taskId) }),
      ]);
      if (onSuccess) {
        await onSuccess(data, taskId, context, mutation);
      }
    },
    ...restOptions,
  });
};
