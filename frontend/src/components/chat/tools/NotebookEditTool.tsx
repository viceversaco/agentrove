import { memo } from 'react';
import { BookOpen } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';

type EditMode = 'replace' | 'insert' | 'delete';

interface NotebookEditInput {
  notebook_path: string;
  new_source: string;
  cell_id?: string;
  cell_type?: 'code' | 'markdown';
  edit_mode?: EditMode;
}

const extractFilename = (path: string): string => path.split('/').pop() ?? path;

const NotebookEditToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as NotebookEditInput | undefined;
  const notebookPath = input?.notebook_path ?? '';
  const editMode = input?.edit_mode ?? 'replace';
  const newSource = input?.new_source ?? '';
  const cellId = input?.cell_id;
  const cellType = input?.cell_type;

  const filename = extractFilename(notebookPath);
  const inProgressLabels: Record<EditMode, string> = {
    replace: 'Editing cell in',
    insert: 'Inserting cell in',
    delete: 'Deleting cell in',
  };
  const completedLabels: Record<EditMode, string> = {
    replace: 'Edited cell in',
    insert: 'Inserted cell in',
    delete: 'Deleted cell in',
  };

  const hasExpandableContent = notebookPath.length > 0 || newSource.length > 0 || cellId;

  return (
    <ToolCard
      icon={<BookOpen className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        const suffix = filename ? ` ${filename}` : '';
        switch (status) {
          case 'completed':
            return `${completedLabels[editMode] ?? editMode}${suffix}`;
          case 'failed':
            return `Failed to ${editMode} cell in${suffix}`;
          default:
            return `${inProgressLabels[editMode] ?? editMode}${suffix}`;
        }
      }}
      loadingContent="Editing notebook..."
      error={tool.error}
      expandable={Boolean(hasExpandableContent)}
    >
      {hasExpandableContent && (
        <div className="space-y-1.5">
          {notebookPath && (
            <div className="truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-quaternary">
              {notebookPath}
            </div>
          )}
          {(cellId || cellType) && (
            <div className="flex gap-3 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {cellId && (
                <span>
                  cell:{' '}
                  <span className="font-mono text-text-tertiary dark:text-text-dark-tertiary">
                    {cellId}
                  </span>
                </span>
              )}
              {cellType && (
                <span>
                  type:{' '}
                  <span className="font-mono text-text-tertiary dark:text-text-dark-tertiary">
                    {cellType}
                  </span>
                </span>
              )}
            </div>
          )}
          {newSource && editMode !== 'delete' && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs leading-relaxed text-text-tertiary dark:text-text-dark-quaternary">
              {newSource}
            </pre>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const NotebookEditTool = memo(NotebookEditToolInner);
