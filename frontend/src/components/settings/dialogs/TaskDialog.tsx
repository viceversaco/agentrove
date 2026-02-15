import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Select } from '@/components/ui/primitives/Select';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { TimePicker } from '@/components/ui/TimePicker';
import { RecurrenceType } from '@/types';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { BaseModal } from '@/components/ui/shared/BaseModal';

interface TaskDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  task: {
    task_name: string;
    prompt_message: string;
    recurrence_type: RecurrenceType;
    scheduled_time: Dayjs | null;
    scheduled_day?: number;
    model_id: string;
  };
  error?: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onTaskChange: (
    field: string,
    value: string | number | undefined | RecurrenceType | Dayjs | null,
  ) => void;
}

export const TaskDialog: React.FC<TaskDialogProps> = ({
  isOpen,
  isEditing,
  task,
  error,
  onClose,
  onSubmit,
  onTaskChange,
}) => {
  const handleRecurrenceChange = (value: string) => {
    const newRecurrence = value as RecurrenceType;
    onTaskChange('recurrence_type', newRecurrence);

    if (newRecurrence === RecurrenceType.ONCE || newRecurrence === RecurrenceType.DAILY) {
      onTaskChange('scheduled_day', undefined);
    } else if (newRecurrence === RecurrenceType.WEEKLY) {
      onTaskChange('scheduled_day', 0);
    } else if (newRecurrence === RecurrenceType.MONTHLY) {
      onTaskChange('scheduled_day', 1);
    }
  };

  const isFormValid = () => {
    return (
      task.task_name.trim().length > 0 &&
      task.prompt_message.trim().length > 0 &&
      task.scheduled_time !== null
    );
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      className="max-h-[90vh] overflow-y-auto shadow-strong"
    >
      <div className="p-6">
        <h3 className="mb-4 text-lg font-semibold text-text-primary dark:text-text-dark-primary">
          {isEditing ? 'Edit Scheduled Task' : 'Create Scheduled Task'}
        </h3>

        {error && (
          <div className="mb-4 rounded-md border border-error-200 bg-error-50 p-3 dark:border-error-800 dark:bg-error-900/20">
            <p className="text-xs text-error-700 dark:text-error-400">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              Task Name
            </Label>
            <Input
              value={task.task_name}
              onChange={(e) => onTaskChange('task_name', e.target.value)}
              placeholder="e.g., Daily standup reminder"
              className="text-sm"
            />
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              This will be the chat title when the task runs
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              Prompt
            </Label>
            <Textarea
              value={task.prompt_message}
              onChange={(e) => onTaskChange('prompt_message', e.target.value)}
              placeholder="e.g., Give me a daily summary of tech news"
              rows={4}
              className="text-sm"
            />
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              This prompt will be sent to the AI when the task executes
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              AI Model
            </Label>
            <ModelSelector
              selectedModelId={task.model_id}
              onModelChange={(modelId) => onTaskChange('model_id', modelId)}
              dropdownPosition="bottom"
            />
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Select which AI model will be used for this task
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              Frequency
            </Label>
            <Select
              value={task.recurrence_type}
              onChange={(e) => handleRecurrenceChange(e.target.value)}
              className="text-sm"
            >
              <option value={RecurrenceType.ONCE}>Once</option>
              <option value={RecurrenceType.DAILY}>Daily</option>
              <option value={RecurrenceType.WEEKLY}>Weekly</option>
              <option value={RecurrenceType.MONTHLY}>Monthly</option>
            </Select>
          </div>

          {task.recurrence_type === RecurrenceType.WEEKLY && (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                Day of Week
              </Label>
              <Select
                value={task.scheduled_day !== undefined ? task.scheduled_day.toString() : '0'}
                onChange={(e) => onTaskChange('scheduled_day', parseInt(e.target.value, 10))}
                className="text-sm"
              >
                <option value="0">Monday</option>
                <option value="1">Tuesday</option>
                <option value="2">Wednesday</option>
                <option value="3">Thursday</option>
                <option value="4">Friday</option>
                <option value="5">Saturday</option>
                <option value="6">Sunday</option>
              </Select>
            </div>
          )}

          {task.recurrence_type === RecurrenceType.MONTHLY && (
            <div>
              <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
                Day of Month
              </Label>
              <Select
                value={task.scheduled_day !== undefined ? task.scheduled_day.toString() : '1'}
                onChange={(e) => onTaskChange('scheduled_day', parseInt(e.target.value, 10))}
                className="text-sm"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                    {day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label className="mb-1.5 text-sm text-text-primary dark:text-text-dark-primary">
              Time
            </Label>
            <TimePicker
              value={task.scheduled_time ? task.scheduled_time.format('HH:mm') : ''}
              onChange={(timeValue) => {
                if (timeValue) {
                  const [hours, minutes] = timeValue.split(':').map(Number);
                  const dayjsValue = dayjs().hour(hours).minute(minutes).second(0);
                  onTaskChange('scheduled_time', dayjsValue);
                } else {
                  onTaskChange('scheduled_time', null);
                }
              }}
              placeholder="Select time"
              className="text-sm"
            />
            <p className="mt-1 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              Time uses your account timezone
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            variant="primary"
            size="sm"
            disabled={!isFormValid()}
          >
            {isEditing ? 'Update Task' : 'Create Task'}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
};
