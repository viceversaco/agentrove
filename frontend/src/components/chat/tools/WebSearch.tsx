import React, { useMemo, type CSSProperties } from 'react';
import { Search, Globe } from 'lucide-react';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';

const DELAY_0: CSSProperties = { animationDelay: '0ms' };
const DELAY_150: CSSProperties = { animationDelay: '150ms' };
const DELAY_300: CSSProperties = { animationDelay: '300ms' };

interface WebSearchProps {
  tool: ToolAggregate;
}

interface SearchSource {
  title: string;
  url: string;
}

interface ZaiSearchResult {
  refer: string;
  title: string;
  link: string;
  media: string;
  content: string;
  icon: string;
  publish_date: string;
}

const SourceChip: React.FC<{ source: SearchSource; index: number }> = ({ source, index }) => {
  let domain = '';
  let faviconUrl: string | null = null;

  try {
    const urlObj = new URL(source.url);
    domain = urlObj.hostname.replace('www.', '');
    faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${domain}`;
  } catch {
    domain = source.url;
  }

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title}
      className="group/chip flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1 transition-all duration-150 hover:bg-surface-hover dark:bg-white/5 dark:hover:bg-surface-dark-hover"
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-2xs font-medium text-text-quaternary dark:text-text-dark-quaternary">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="h-3 w-3 rounded-sm"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <Globe
          className={`h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary ${faviconUrl ? 'hidden' : ''}`}
        />
      </span>
      <span className="max-w-32 truncate text-2xs text-text-secondary transition-colors duration-150 group-hover/chip:text-text-primary dark:text-text-dark-tertiary dark:group-hover/chip:text-text-dark-primary">
        {domain}
      </span>
      <span className="text-2xs tabular-nums text-text-quaternary/60 dark:text-text-dark-quaternary/60">
        {index + 1}
      </span>
    </a>
  );
};

export const WebSearch: React.FC<WebSearchProps> = ({ tool }) => {
  const parseZaiSearchResults = (result: unknown): SearchSource[] => {
    try {
      if (!Array.isArray(result)) {
        return [];
      }

      const firstItem = result[0];
      if (!firstItem || firstItem.type !== 'text' || typeof firstItem.text !== 'string') {
        return [];
      }

      const zaiResults = JSON.parse(firstItem.text) as ZaiSearchResult[];
      return zaiResults.map((item) => ({
        title: item.title,
        url: item.link,
      }));
    } catch {
      return [];
    }
  };

  const parseClaudeSearchResults = (result: string): SearchSource[] => {
    try {
      const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?=\s*\n|$)/);
      if (linksMatch?.[1]) {
        return JSON.parse(linksMatch[1]) as SearchSource[];
      }
    } catch {
      return [];
    }
    return [];
  };

  const query = ((tool.input?.query || tool.input?.search_query) as string | undefined) ?? '';
  const toolStatus = tool.status;
  const errorMessage = tool.error;

  const sources: SearchSource[] = useMemo(() => {
    if (typeof tool.result === 'string') {
      const claudeResults = parseClaudeSearchResults(tool.result);
      if (claudeResults.length > 0) {
        return claudeResults;
      }
    }

    const zaiResults = parseZaiSearchResults(tool.result);
    if (zaiResults.length > 0) {
      return zaiResults;
    }

    return [];
  }, [tool.result]);

  const canShowSources = sources.length > 0;

  return (
    <ToolCard
      icon={<Search className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={toolStatus}
      title={(status) => {
        switch (status) {
          case 'completed':
            return `Searched: ${query}`;
          case 'failed':
            return `Search failed: ${query}`;
          default:
            return `Searching: ${query}`;
        }
      }}
      loadingContent={
        <div className="mt-0.5 flex items-center gap-1.5">
          <div className="flex space-x-1">
            <div
              className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary dark:bg-text-dark-tertiary"
              style={DELAY_0}
            />
            <div
              className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary dark:bg-text-dark-tertiary"
              style={DELAY_150}
            />
            <div
              className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary dark:bg-text-dark-tertiary"
              style={DELAY_300}
            />
          </div>
          <p className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">
            Searching the web
          </p>
        </div>
      }
      error={errorMessage}
      expandable={canShowSources}
    >
      {canShowSources && (
        <div>
          <div className="flex flex-wrap gap-1">
            {sources.map((source, index) => (
              <SourceChip key={`${index}-${source.url}`} source={source} index={index} />
            ))}
          </div>
        </div>
      )}
    </ToolCard>
  );
};
