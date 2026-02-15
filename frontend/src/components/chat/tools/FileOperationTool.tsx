import { memo, useMemo } from 'react';
import { diffLines } from 'diff';
import { FileSearch, FileEdit as FileEditIcon, FilePlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import type { ToolComponent } from '@/types/ui.types';
import { ToolCard } from './common/ToolCard';

interface FileOperationToolProps {
  tool: ToolAggregate;
  variant: 'read' | 'edit' | 'write';
}

interface TitleConfig {
  inProgress: string;
  completed: string;
  failed: string;
}

interface OperationConfig {
  icon: LucideIcon;
  loadingContent: string;
  titles: TitleConfig;
}

const OPERATION_CONFIGS: Record<'read' | 'edit' | 'write', OperationConfig> = {
  read: {
    icon: FileSearch,
    loadingContent: 'Loading file content...',
    titles: { inProgress: 'Reading', completed: 'Read', failed: 'Failed to read' },
  },
  edit: {
    icon: FileEditIcon,
    loadingContent: 'Applying changes...',
    titles: { inProgress: 'Editing', completed: 'Edited', failed: 'Failed to edit' },
  },
  write: {
    icon: FilePlus,
    loadingContent: 'Writing file...',
    titles: { inProgress: 'Writing', completed: 'Wrote', failed: 'Failed to write' },
  },
};

const normalizeContent = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.join('\n');
  if (result === null || result === undefined) return '';
  return JSON.stringify(result, null, 2);
};

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
}

const computeDiffLines = (oldStr: string, newStr: string): DiffLine[] => {
  const changes = diffLines(oldStr, newStr);
  const result: DiffLine[] = [];

  for (const change of changes) {
    const lines = change.value.endsWith('\n')
      ? change.value.slice(0, -1).split('\n')
      : change.value.split('\n');

    for (const line of lines) {
      if (change.removed) {
        result.push({ type: 'removed', content: line });
      } else if (change.added) {
        result.push({ type: 'added', content: line });
      } else {
        result.push({ type: 'context', content: line });
      }
    }
  }

  return result;
};

const InlineDiff: React.FC<{ oldContent: string; newContent: string }> = ({
  oldContent,
  newContent,
}) => {
  const lines = useMemo(() => computeDiffLines(oldContent, newContent), [oldContent, newContent]);

  if (lines.length === 0) {
    return (
      <p className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
        No changes detected
      </p>
    );
  }

  return (
    <div className="max-h-48 overflow-auto font-mono text-2xs leading-relaxed">
      {lines.map((line, idx) => (
        <div key={idx} className="flex">
          <span
            className={`w-4 flex-shrink-0 select-none text-center ${
              line.type === 'removed'
                ? 'text-error-600/40 dark:text-error-400/40'
                : line.type === 'added'
                  ? 'text-success-600/40 dark:text-success-400/40'
                  : 'text-transparent'
            }`}
          >
            {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
          </span>
          <span
            className={`whitespace-pre ${
              line.type === 'removed'
                ? 'text-text-quaternary line-through dark:text-text-dark-quaternary'
                : line.type === 'added'
                  ? 'text-text-secondary dark:text-text-dark-secondary'
                  : 'text-text-tertiary dark:text-text-dark-tertiary'
            }`}
          >
            {line.content || '\u00A0'}
          </span>
        </div>
      ))}
    </div>
  );
};

const FileOperationToolInner: React.FC<FileOperationToolProps> = ({ tool, variant }) => {
  const config = OPERATION_CONFIGS[variant];
  const Icon = config.icon;
  const filePath = (tool.input?.file_path as string | undefined) ?? '';

  const renderContent = () => {
    if (variant === 'read') {
      const content = normalizeContent(tool.result);
      if (!content || tool.status !== 'completed') return null;

      const lines = content.split('\n');
      return (
        <div className="max-h-48 overflow-auto font-mono text-2xs leading-relaxed">
          {lines.map((line: string, idx: number) => {
            const match = line.match(/^\s*(\d+)→/);
            const lineNum = match ? match[1] : String(idx + 1);
            const lineContent = line.replace(/^\s*\d+→/, '');
            return (
              <div key={idx} className="flex">
                <span className="w-8 flex-shrink-0 select-none pr-2 text-right text-text-quaternary dark:text-text-dark-quaternary">
                  {lineNum}
                </span>
                <span className="whitespace-pre text-text-tertiary dark:text-text-dark-tertiary">
                  {lineContent || '\u00A0'}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    if (variant === 'edit') {
      const oldString = typeof tool.input?.old_string === 'string' ? tool.input.old_string : '';
      const newString = typeof tool.input?.new_string === 'string' ? tool.input.new_string : '';
      if (!oldString && !newString) return null;

      return <InlineDiff oldContent={oldString} newContent={newString} />;
    }

    const content = typeof tool.input?.content === 'string' ? tool.input.content : '';
    if (!content) return null;

    const lines = content.split('\n');
    return (
      <div className="max-h-48 overflow-auto font-mono text-2xs leading-relaxed">
        {lines.map((line: string, idx: number) => (
          <div key={idx} className="flex">
            <span className="w-8 flex-shrink-0 select-none pr-2 text-right text-text-quaternary dark:text-text-dark-quaternary">
              {idx + 1}
            </span>
            <span className="whitespace-pre text-text-tertiary dark:text-text-dark-tertiary">
              {line || '\u00A0'}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const hasExpandableContent =
    (variant === 'read' && tool.result && tool.status === 'completed') ||
    (variant === 'edit' &&
      (typeof tool.input?.old_string === 'string' || typeof tool.input?.new_string === 'string')) ||
    (variant === 'write' && typeof tool.input?.content === 'string' && tool.input.content);

  return (
    <ToolCard
      icon={<Icon className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `${config.titles.completed} ${filePath}`;
          case 'failed':
            return `${config.titles.failed} ${filePath}`;
          default:
            return `${config.titles.inProgress} ${filePath}`;
        }
      }}
      loadingContent={config.loadingContent}
      error={tool.error}
      expandable={Boolean(hasExpandableContent)}
    >
      {renderContent()}
    </ToolCard>
  );
};

const FileOperationTool = memo(FileOperationToolInner);

export const WriteTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="write" />
);

export const ReadTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="read" />
);

export const EditTool: ToolComponent = ({ tool }) => (
  <FileOperationTool tool={tool} variant="edit" />
);
