import React, { memo } from 'react';
import { Wrench } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';

interface MCPToolProps {
  tool: ToolAggregate;
}

const formatToolName = (toolName: string): string => {
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.slice(5).split('__');
    if (parts.length >= 2) {
      const serverName = parts[0];
      const tool = parts.slice(1).join('__');
      const formattedTool = tool
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      return `MCP: ${serverName} - ${formattedTool}`;
    }
  }

  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatValue = (value: unknown): React.ReactNode => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
};

const MCPToolInner: React.FC<MCPToolProps> = ({ tool }) => {
  const isMcpTool = tool.name.startsWith('mcp__');
  const formattedToolName = formatToolName(tool.name);

  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const description =
    !isMcpTool && typeof tool.input?.description === 'string' ? tool.input.description : null;
  const inputEntries = Object.entries(tool.input || {}).filter(
    ([key]) => !(key === 'description' && description),
  );
  const hasInput = inputEntries.length > 0;
  const hasResult = Boolean(
    tool.result &&
    (Array.isArray(tool.result)
      ? tool.result.length > 0
      : typeof tool.result === 'object'
        ? Object.keys(tool.result as object).length > 0
        : true),
  );
  const hasDetails = hasInput || (hasResult && toolStatus === 'completed');
  const title = description ? `${formattedToolName}: ${description}` : formattedToolName;

  return (
    <ToolCard
      icon={<Wrench className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={toolStatus}
      title={title}
      loadingContent="Processing..."
      error={errorMessage}
      expandable={hasDetails}
    >
      {hasDetails ? (
        <div className="space-y-1.5">
          {hasInput
            ? inputEntries.map(([key, value]) => (
                <div key={key}>
                  <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                    {key}:{' '}
                  </span>
                  <span className="whitespace-pre-wrap break-all font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                    {formatValue(value)}
                  </span>
                </div>
              ))
            : null}
          {hasResult && toolStatus === 'completed' ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs leading-relaxed text-text-tertiary dark:text-text-dark-quaternary">
              {formatValue(tool.result)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </ToolCard>
  );
};

export const MCPTool = memo(MCPToolInner);
