import { useMemo } from 'react';
import { useSuggestionBase } from './useSuggestionBase';
import type { SlashCommand } from '@/types/ui.types';
import type { CustomCommand } from '@/types/user.types';

const SLASH_COMMANDS: SlashCommand[] = [
  {
    value: '/context',
    label: 'Context',
    description: 'Visualize current context usage',
  },
  {
    value: '/compact',
    label: 'Compact',
    description:
      'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]',
  },
  {
    value: '/pr-comments',
    label: 'PR Comments',
    description: 'Get comments from a GitHub pull request',
  },
  {
    value: '/review',
    label: 'Review',
    description: 'Review a pull request',
  },
  {
    value: '/init',
    label: 'Init',
    description: 'Initialize a new CLAUDE.md file with codebase documentation',
  },
  {
    value: '/debug',
    label: 'Debug',
    description: 'Debug you current Claude code session',
  },
  {
    value: '/security-review',
    label: 'Security Review',
    description: 'Complete a security review of the pending changes on the current branch',
  },
  {
    value: '/insights',
    label: 'Insights',
    description: 'Generate a report analyzing your Claude code sessions',
  },
  {
    value: '/simplify',
    label: 'Simplify',
    description: 'Review changed code for reuse, quality and efficiency, then fix any issues found',
  },
  {
    value: '/loop',
    label: 'Loop',
    description: 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)',
  },
  {
    value: '/frontend-design',
    label: 'Frontend Design',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality',
  },
  {
    value: '/batch',
    label: 'Batch',
    description: 'Research and plan a large-scale change, then execute it in parallel across 5-30 isolated worktree agents that each open a PR'
  }
];

interface UseSlashCommandOptions {
  message: string;
  onSelect: (command: SlashCommand) => void;
  customSlashCommands?: CustomCommand[];
}

export const useSlashCommandSuggestions = ({
  message,
  onSelect,
  customSlashCommands = [],
}: UseSlashCommandOptions) => {
  const allCommands = useMemo(() => {
    const customCommandsFormatted: SlashCommand[] = customSlashCommands.map((cmd) => ({
      value: `/${cmd.name}`,
      label: cmd.name,
      description: cmd.description,
    }));
    return [...SLASH_COMMANDS, ...customCommandsFormatted];
  }, [customSlashCommands]);

  const { isActive, query } = useMemo(() => {
    const firstLine = message.split('\n', 1)[0] ?? '';
    const trimmedFirstLine = firstLine.trimStart();

    if (trimmedFirstLine.startsWith('/') && !trimmedFirstLine.includes(' ')) {
      return {
        isActive: true,
        query: trimmedFirstLine.slice(1).toLowerCase(),
      } as const;
    }

    return { isActive: false, query: '' } as const;
  }, [message]);

  const filteredCommands = useMemo(() => {
    if (!isActive) return [];
    if (!query) return allCommands;
    return allCommands.filter((command) => command.value.slice(1).toLowerCase().startsWith(query));
  }, [isActive, query, allCommands]);

  const hasSuggestions = filteredCommands.length > 0;

  const { highlightedIndex, selectItem, handleKeyDown } = useSuggestionBase({
    suggestions: filteredCommands,
    hasSuggestions,
    onSelect,
  });

  return {
    filteredCommands,
    highlightedIndex,
    hasSuggestions,
    selectCommand: selectItem,
    handleKeyDown,
  } as const;
};
