import { memo } from 'react';
import { Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';

interface WebFetchInput {
  url: string;
  prompt: string;
}

const formatResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (result === null || result === undefined) return '';
  return JSON.stringify(result, null, 2);
};

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url.length > 30 ? `${url.slice(0, 27)}...` : url;
  }
};

const WebFetchToolInner: React.FC<{ tool: ToolAggregate }> = ({ tool }) => {
  const input = tool.input as WebFetchInput | undefined;
  const url = input?.url ?? '';
  const prompt = input?.prompt ?? '';

  const domain = extractDomain(url) || 'content';
  const result = formatResult(tool.result);
  const hasExpandableContent = url.length > 0 || (result.length > 0 && tool.status === 'completed');

  return (
    <ToolCard
      icon={<Globe className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Fetched: ${domain}`;
          case 'failed':
            return `Failed to fetch: ${domain}`;
          default:
            return `Fetching: ${domain}`;
        }
      }}
      loadingContent="Fetching content..."
      error={tool.error}
      expandable={hasExpandableContent}
    >
      {hasExpandableContent && (
        <div className="space-y-1.5">
          {url && (
            <div className="truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-quaternary">
              {url}
            </div>
          )}
          {prompt && (
            <p className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">{prompt}</p>
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

export const WebFetchTool = memo(WebFetchToolInner);
