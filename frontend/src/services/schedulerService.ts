import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type {
  ScheduledTask,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  TaskToggleResponse,
} from '@/types/scheduler.types';
import { validateId } from '@/utils/validation';

async function createTask(data: CreateScheduledTaskRequest): Promise<ScheduledTask> {
  return withAuth(async () => {
    const response = await apiClient.post<ScheduledTask>('/scheduler/tasks', data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function getTasks(): Promise<ScheduledTask[]> {
  return withAuth(async () => {
    const response = await apiClient.get<ScheduledTask[]>('/scheduler/tasks');
    return response ?? [];
  });
}

async function updateTask(
  taskId: string,
  data: UpdateScheduledTaskRequest,
): Promise<ScheduledTask> {
  validateId(taskId, 'Task ID');

  return withAuth(async () => {
    const response = await apiClient.put<ScheduledTask>(`/scheduler/tasks/${taskId}`, data);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteTask(taskId: string): Promise<void> {
  validateId(taskId, 'Task ID');

  return withAuth(async () => {
    await apiClient.delete(`/scheduler/tasks/${taskId}`);
  });
}

async function toggleTask(taskId: string): Promise<TaskToggleResponse> {
  validateId(taskId, 'Task ID');

  return withAuth(async () => {
    const response = await apiClient.post<TaskToggleResponse>(`/scheduler/tasks/${taskId}/toggle`);
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const schedulerService = {
  createTask,
  getTasks,
  updateTask,
  deleteTask,
  toggleTask,
};
