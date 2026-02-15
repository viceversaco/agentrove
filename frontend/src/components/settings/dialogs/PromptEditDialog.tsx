import type { CustomPrompt } from '@/types';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Label } from '@/components/ui/primitives/Label';
import { Textarea } from '@/components/ui/primitives/Textarea';
import { BaseModal } from '@/components/ui/shared/BaseModal';

interface PromptEditDialogProps {
  isOpen: boolean;
  isEditing: boolean;
  prompt: CustomPrompt;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onPromptChange: <K extends keyof CustomPrompt>(field: K, value: CustomPrompt[K]) => void;
}

export const PromptEditDialog: React.FC<PromptEditDialogProps> = ({
  isOpen,
  isEditing,
  prompt,
  error,
  onClose,
  onSubmit,
  onPromptChange,
}) => {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      className="max-h-[90vh] overflow-y-auto"
    >
      <div className="p-5">
        <h3 className="mb-5 text-sm font-medium text-text-primary dark:text-text-dark-primary">
          {isEditing ? 'Edit Prompt' : 'Add Prompt'}
        </h3>

        {error && (
          <div className="mb-4 rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Name
            </Label>
            <Input
              value={prompt.name}
              onChange={(e) => onPromptChange('name', e.target.value)}
              placeholder="code-reviewer"
              className="text-xs"
            />
            <p className="mt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Use @prompt:name to select when chatting
            </p>
          </div>

          <div>
            <Label className="mb-1.5 text-xs text-text-secondary dark:text-text-dark-secondary">
              Content
            </Label>
            <Textarea
              value={prompt.content}
              onChange={(e) => onPromptChange('content', e.target.value)}
              placeholder="You are an expert code reviewer..."
              className="min-h-[300px] font-mono text-xs"
              rows={15}
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            variant="outline"
            size="sm"
            className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
            disabled={!prompt.name.trim() || !prompt.content.trim()}
          >
            {isEditing ? 'Update' : 'Add Prompt'}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
};
