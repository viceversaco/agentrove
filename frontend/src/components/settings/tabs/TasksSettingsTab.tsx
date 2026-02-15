import { useCallback, useMemo, useState } from 'react';
import { logger } from '@/utils/logger';
import type { ScheduledTask } from '@/types/scheduler.types';
import { RecurrenceType, TaskStatus } from '@/types/scheduler.types';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Plus,
  CalendarClock,
  Loader2,
  Clock,
  Calendar,
  Play,
  Pause,
  Edit2,
  Trash2,
} from 'lucide-react';
import {
  useDeleteScheduledTaskMutation,
  useScheduledTasksQuery,
  useToggleScheduledTaskMutation,
} from '@/hooks/queries/useScheduler';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { formatLocalTime } from '@/utils/date';

interface TasksSettingsTabProps {
  onAddTask: () => void;
  onEditTask: (task: ScheduledTask) => void;
}

const getOrdinalSuffix = (day: number): string => {
  if (day === 1 || day === 21 || day === 31) return 'st';
  if (day === 2 || day === 22) return 'nd';
  if (day === 3 || day === 23) return 'rd';
  return 'th';
};

export const TasksSettingsTab: React.FC<TasksSettingsTabProps> = ({ onAddTask, onEditTask }) => {
  const { data: tasks, isLoading, error } = useScheduledTasksQuery();
  const [taskPendingDelete, setTaskPendingDelete] = useState<ScheduledTask | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const deleteTask = useDeleteScheduledTaskMutation();
  const toggleTask = useToggleScheduledTaskMutation();

  const tasksList = tasks ?? [];
  const total = tasksList.length;
  const activeCount = useMemo(
    () => (tasks ?? []).filter((t) => t.status === TaskStatus.ACTIVE).length,
    [tasks],
  );

  const handleToggleTask = useCallback(
    async (task: ScheduledTask) => {
      setTogglingTaskId(task.id);
      try {
        await toggleTask.mutateAsync(task.id);
      } catch (error) {
        logger.error('Failed to toggle task', 'TasksSettingsTab', error);
        toast.error('Failed to toggle task status');
      } finally {
        setTogglingTaskId(null);
      }
    },
    [toggleTask],
  );

  const handleDeleteRequest = useCallback((task: ScheduledTask) => {
    setTaskPendingDelete(task);
  }, []);

  const handleCloseDeleteDialog = useCallback(() => {
    setTaskPendingDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!taskPendingDelete) return;
    const targetTask = taskPendingDelete;
    setDeletingTaskId(targetTask.id);
    try {
      await deleteTask.mutateAsync(targetTask.id);
      setTaskPendingDelete(null);
    } catch (error) {
      logger.error('Failed to delete task', 'TasksSettingsTab', error);
      toast.error('Failed to delete task');
    } finally {
      setDeletingTaskId(null);
    }
  }, [taskPendingDelete, deleteTask]);

  const getRecurrenceDisplay = (task: ScheduledTask) => {
    const timeLabel = formatLocalTime(task.scheduled_time);

    switch (task.recurrence_type) {
      case RecurrenceType.ONCE:
        return `Once at ${timeLabel}`;
      case RecurrenceType.DAILY:
        return `Daily at ${timeLabel}`;
      case RecurrenceType.WEEKLY: {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const dayName =
          task.scheduled_day !== null && task.scheduled_day >= 0 && task.scheduled_day < days.length
            ? days[task.scheduled_day]
            : 'Unknown day';
        return `Every ${dayName} at ${timeLabel}`;
      }
      case RecurrenceType.MONTHLY: {
        if (task.scheduled_day == null) {
          return `Monthly at ${timeLabel}`;
        }
        const day = task.scheduled_day;
        const suffix = getOrdinalSuffix(day);
        return `Monthly on the ${day}${suffix} at ${timeLabel}`;
      }
      default:
        return 'Unknown';
    }
  };

  const getNextExecutionDisplay = (task: ScheduledTask) => {
    if (!task.next_execution) return 'Not scheduled';
    const nextDate = new Date(task.next_execution);
    const now = new Date();

    if (nextDate < now) {
      return 'Running now...';
    }

    const distance = formatDistanceToNow(nextDate, { addSuffix: true });
    return distance;
  };

  const getStatusBadge = (task: ScheduledTask) => {
    switch (task.status) {
      case TaskStatus.ACTIVE:
        return (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-secondary dark:border-border-dark dark:text-text-dark-secondary">
            Active
          </span>
        );
      case TaskStatus.PAUSED:
        return (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-quaternary dark:border-border-dark dark:text-text-dark-quaternary">
            Paused
          </span>
        );
      case TaskStatus.FAILED:
        return (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-quaternary dark:border-border-dark dark:text-text-dark-quaternary">
            Failed
          </span>
        );
      case TaskStatus.COMPLETED:
        return (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-quaternary dark:border-border-dark dark:text-text-dark-quaternary">
            Completed
          </span>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="mb-4">
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Scheduled Tasks
            </h2>
          </div>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-text-secondary dark:text-text-dark-secondary" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <div className="mb-4">
            <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
              Scheduled Tasks
            </h2>
          </div>
          <div className="rounded-xl border border-border p-4 text-text-secondary dark:border-border-dark dark:text-text-dark-secondary">
            <p>Error loading tasks. Please try again.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <h2 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Scheduled Tasks
          </h2>
          <Button
            type="button"
            onClick={onAddTask}
            variant="outline"
            size="sm"
            className="flex w-full shrink-0 items-center justify-center gap-1.5 sm:w-auto"
            aria-label="Add new scheduled task"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
        </div>

        <p className="mb-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
          Automate your workflows with scheduled AI tasks. Each task creates a new chat with your
          prompt at the specified time.
        </p>

        {tasksList.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center dark:border-border-dark">
            <CalendarClock className="mx-auto mb-3 h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
            <p className="mb-3 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              No scheduled tasks configured yet
            </p>
            <Button type="button" onClick={onAddTask} variant="outline" size="sm">
              Create Your First Task
            </Button>
          </div>
        ) : (
          <>
            {total > 0 && (
              <p className="mb-3 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                {total} tasks • {activeCount} active
              </p>
            )}
            <div className="space-y-3">
              {tasksList.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border border-border p-4 transition-colors duration-200 hover:border-border-hover dark:border-border-dark dark:hover:border-border-dark-hover"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
                          {task.task_name}
                        </h3>
                        {getStatusBadge(task)}
                      </div>

                      <p className="mb-3 line-clamp-2 text-xs text-text-secondary dark:text-text-dark-secondary">
                        {task.prompt_message}
                      </p>

                      <div className="flex flex-wrap gap-4 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          <span>{getRecurrenceDisplay(task)}</span>
                        </div>

                        {task.next_execution && task.status === TaskStatus.ACTIVE && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3" />
                            <span>Next: {getNextExecutionDisplay(task)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleTask(task)}
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                        title={task.status === TaskStatus.ACTIVE ? 'Pause task' : 'Resume task'}
                        aria-label={
                          task.status === TaskStatus.ACTIVE ? 'Pause task' : 'Resume task'
                        }
                        disabled={togglingTaskId === task.id}
                      >
                        {togglingTaskId === task.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : task.status === TaskStatus.ACTIVE ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onEditTask(task)}
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                        title="Edit task"
                        aria-label="Edit task"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRequest(task)}
                        className="h-7 w-7 text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                        title="Delete task"
                        aria-label="Delete task"
                        disabled={deletingTaskId === task.id}
                      >
                        {deletingTaskId === task.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={taskPendingDelete !== null}
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="Delete Task"
        message={`Are you sure you want to delete "${taskPendingDelete?.task_name ?? 'this task'}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
};
