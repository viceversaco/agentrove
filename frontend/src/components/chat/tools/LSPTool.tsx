import { memo } from 'react';
import { Code } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';

type LSPOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls';

interface LSPInput {
  operation: LSPOperation;
  filePath: string;
  line?: number;
  character?: number;
}

const formatResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';
  return JSON.stringify(result, null, 2);
};

const extractFilename = (path: string): string => path.split('/').pop() ?? path;

const LSPToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as LSPInput | undefined;
  const operation = input?.operation;
  const filePath = input?.filePath ?? '';
  const line = input?.line;
  const character = input?.character;

  const filename = extractFilename(filePath);
  const location =
    line !== undefined ? `:${line}${character !== undefined ? `:${character}` : ''}` : '';
  const opLabel = operation ?? 'query';

  const result = formatResult(tool.result);
  const hasExpandableContent =
    filePath.length > 0 || (result.length > 0 && tool.status === 'completed');

  return (
    <ToolCard
      icon={<Code className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `LSP ${opLabel}: ${filename}${location}`;
          case 'failed':
            return `LSP ${opLabel} failed: ${filename}${location}`;
          default:
            return `LSP running ${opLabel}: ${filename}${location}`;
        }
      }}
      loadingContent={`Running ${opLabel}...`}
      error={tool.error}
      expandable={hasExpandableContent}
    >
      {hasExpandableContent && (
        <div className="space-y-1.5">
          {filePath && (
            <div className="truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-quaternary">
              {filePath}
              {location}
            </div>
          )}
          {result.length > 0 && tool.status === 'completed' && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs leading-relaxed text-text-tertiary dark:text-text-dark-quaternary">
              {result}
            </pre>
          )}
        </div>
      )}
    </ToolCard>
  );
};

export const LSPTool = memo(LSPToolInner);
