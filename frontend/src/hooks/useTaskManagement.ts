import { useState, useCallback } from 'react';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import type { RecurrenceType, ScheduledTask } from '@/types/scheduler.types';
import {
  useCreateScheduledTaskMutation,
  useUpdateScheduledTaskMutation,
} from '@/hooks/queries/useScheduler';
import { normalizeLocalTimeInput, parseScheduledTime } from '@/utils/date';

interface TaskFormType {
  task_name: string;
  prompt_message: string;
  recurrence_type: RecurrenceType;
  scheduled_time: Dayjs | null;
  scheduled_day: number | undefined;
  model_id: string;
}

const createDefaultTaskForm = (): TaskFormType => ({
  task_name: '',
  prompt_message: '',
  recurrence_type: 'daily' as RecurrenceType,
  scheduled_time: dayjs('09:00', 'HH:mm'),
  scheduled_day: undefined,
  model_id: '',
});

export const useTaskManagement = (defaultModelId: string) => {
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormType>(createDefaultTaskForm());
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  const createTask = useCreateScheduledTaskMutation();
  const updateTask = useUpdateScheduledTaskMutation();

  const resetTaskForm = useCallback(() => {
    setTaskForm(createDefaultTaskForm());
    setEditingTaskId(null);
    setTaskFormError(null);
  }, []);

  const handleAddTask = useCallback(() => {
    setEditingTaskId(null);
    setTaskForm({
      ...createDefaultTaskForm(),
      model_id: defaultModelId || '',
    });
    setTaskFormError(null);
    setIsTaskDialogOpen(true);
  }, [defaultModelId]);

  const handleEditTask = useCallback((task: ScheduledTask) => {
    setEditingTaskId(task.id);
    setTaskForm({
      task_name: task.task_name,
      prompt_message: task.prompt_message,
      recurrence_type: task.recurrence_type,
      scheduled_time: parseScheduledTime(task.scheduled_time),
      scheduled_day: task.scheduled_day !== null ? task.scheduled_day : undefined,
      model_id: task.model_id || '',
    });
    setTaskFormError(null);
    setIsTaskDialogOpen(true);
  }, []);

  const handleTaskFormChange = useCallback(
    (field: string, value: string | number | undefined | RecurrenceType | Dayjs | null) => {
      setTaskForm((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleTaskDialogClose = useCallback(() => {
    setIsTaskDialogOpen(false);
    resetTaskForm();
  }, [resetTaskForm]);

  const handleSaveTask = useCallback(async () => {
    if (!taskForm.task_name.trim()) {
      setTaskFormError('Task name is required');
      return;
    }
    if (!taskForm.prompt_message.trim()) {
      setTaskFormError('Prompt message is required');
      return;
    }
    if (!taskForm.scheduled_time) {
      setTaskFormError('Please select a time');
      return;
    }
    if (!taskForm.model_id) {
      setTaskFormError('Please select a model');
      return;
    }
    if (taskForm.recurrence_type === 'weekly' && taskForm.scheduled_day === undefined) {
      setTaskFormError('Please select a day of the week');
      return;
    }
    if (taskForm.recurrence_type === 'monthly' && taskForm.scheduled_day === undefined) {
      setTaskFormError('Please select a day of the month');
      return;
    }

    const timeString = normalizeLocalTimeInput(taskForm.scheduled_time.format('HH:mm'));
    const taskData = {
      task_name: taskForm.task_name,
      prompt_message: taskForm.prompt_message,
      recurrence_type: taskForm.recurrence_type,
      scheduled_time: timeString,
      scheduled_day: taskForm.scheduled_day,
      model_id: taskForm.model_id,
    };

    try {
      if (editingTaskId !== null) {
        await updateTask.mutateAsync({
          taskId: editingTaskId,
          data: taskData,
        });
      } else {
        await createTask.mutateAsync(taskData);
      }
      handleTaskDialogClose();
    } catch (error) {
      setTaskFormError(error instanceof Error ? error.message : 'Failed to save task');
    }
  }, [taskForm, editingTaskId, updateTask, createTask, handleTaskDialogClose]);

  return {
    isTaskDialogOpen,
    editingTaskId,
    taskForm,
    taskFormError,
    handleAddTask,
    handleEditTask,
    handleTaskFormChange,
    handleTaskDialogClose,
    handleSaveTask,
  };
};
