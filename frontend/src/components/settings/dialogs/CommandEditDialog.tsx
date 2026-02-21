import { useState, useEffect, lazy, Suspense } from 'react';

const Editor = lazy(() => import('@monaco-editor/react'));
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type { CustomCommand } from '@/types/user.types';

interface CommandEditDialogProps {
  isOpen: boolean;
  command: CustomCommand | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}

export const CommandEditDialog: React.FC<CommandEditDialogProps> = ({
  isOpen,
  command,
  error,
  saving,
  onClose,
  onSave,
}) => {
  const [editedContent, setEditedContent] = useState('');
  const theme = useResolvedTheme();

  useEffect(() => {
    if (command) {
      setEditedContent(command.content);
    }
  }, [command]);

  const handleSave = async () => {
    if (!editedContent.trim()) {
      return;
    }
    await onSave(editedContent);
  };

  const handleClose = () => {
    setEditedContent('');
    onClose();
  };

  if (!isOpen || !command) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} size="4xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 dark:border-border-dark">
        <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Edit Command: /{command.name}
        </h3>
        <button
          onClick={handleClose}
          aria-label="Close dialog"
          className="text-text-quaternary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="h-[600px] p-4">
        <Suspense
          fallback={
            <div className="h-full animate-pulse rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary" />
          }
        >
          <Editor
            height="100%"
            language="markdown"
            value={editedContent}
            onChange={(value) => setEditedContent(value || '')}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              automaticLayout: true,
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            }}
            loading={
              <div className="flex h-full items-center justify-center text-text-quaternary dark:text-text-dark-quaternary">
                Loading editor...
              </div>
            }
          />
        </Suspense>
      </div>

      {error && (
        <div className="px-5 pb-2">
          <div className="rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">{error}</p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3 dark:border-border-dark">
        <Button onClick={handleClose} variant="outline" size="sm" disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="outline"
          size="sm"
          className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
          isLoading={saving}
          disabled={!editedContent.trim()}
        >
          Save Changes
        </Button>
      </div>
    </BaseModal>
  );
};
