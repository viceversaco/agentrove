import { useCallback, useDeferredValue, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { CustomAgent, CustomPrompt } from '@/types/user.types';
import type { MentionItem } from '@/types/ui.types';
import { useSuggestionBase } from './useSuggestionBase';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { parseMentionQuery } from '@/utils/mentionParser';
import { fuzzySearch } from '@/utils/fuzzySearch';

interface UseMentionOptions {
  message: string;
  cursorPosition: number;
  fileStructure: FileStructure[];
  customAgents: CustomAgent[];
  customPrompts: CustomPrompt[];
  onSelect: (item: MentionItem, mentionStartPos: number, mentionEndPos: number) => void;
}

const convertFilesToMentions = (files: FileStructure[]): MentionItem[] => {
  return traverseFileStructure(files, (item) => {
    if (item.type === 'file') {
      return {
        type: 'file' as const,
        name: getFileName(item.path),
        path: item.path,
      };
    }
    return null;
  });
};

const convertAgentsToMentions = (agents: CustomAgent[]): MentionItem[] => {
  return agents.map((agent) => ({
    type: 'agent' as const,
    name: agent.name,
    path: `agent:${agent.name}`,
    description: agent.description,
  }));
};

const convertPromptsToMentions = (prompts: CustomPrompt[]): MentionItem[] => {
  return prompts.map((prompt) => ({
    type: 'prompt' as const,
    name: prompt.name,
    path: `prompt:${prompt.name}`,
  }));
};

export const useMentionSuggestions = ({
  message,
  cursorPosition,
  fileStructure,
  customAgents,
  customPrompts,
  onSelect,
}: UseMentionOptions) => {
  const allFiles = useMemo(() => convertFilesToMentions(fileStructure), [fileStructure]);
  const allAgents = useMemo(() => convertAgentsToMentions(customAgents), [customAgents]);
  const allPrompts = useMemo(() => convertPromptsToMentions(customPrompts), [customPrompts]);

  const { isActive, query, mentionStartPos, mentionEndPos } = parseMentionQuery(
    message,
    cursorPosition,
  );

  const deferredQuery = useDeferredValue(query);

  const { filteredFiles, filteredAgents, filteredPrompts, allSuggestions } = useMemo(() => {
    if (!isActive) {
      return { filteredFiles: [], filteredAgents: [], filteredPrompts: [], allSuggestions: [] };
    }

    const files = fuzzySearch(deferredQuery, allFiles, { keys: ['name', 'path'], limit: 30 });
    const agents = fuzzySearch(deferredQuery, allAgents, {
      keys: ['name', 'description'],
      limit: 20,
    });
    const prompts = fuzzySearch(deferredQuery, allPrompts, { keys: ['name'], limit: 20 });

    return {
      filteredFiles: files,
      filteredAgents: agents,
      filteredPrompts: prompts,
      allSuggestions: [...files, ...agents, ...prompts],
    };
  }, [isActive, deferredQuery, allFiles, allAgents, allPrompts]);

  const hasSuggestions = allSuggestions.length > 0;

  const handleSelect = useCallback(
    (item: MentionItem) => {
      if (mentionStartPos === -1) return;
      onSelect(item, mentionStartPos, mentionEndPos);
    },
    [onSelect, mentionStartPos, mentionEndPos],
  );

  const { highlightedIndex, selectItem, handleKeyDown } = useSuggestionBase({
    suggestions: allSuggestions,
    hasSuggestions,
    onSelect: handleSelect,
  });

  return {
    filteredFiles,
    filteredAgents,
    filteredPrompts,
    allSuggestions,
    highlightedIndex,
    hasSuggestions,
    selectItem,
    handleKeyDown,
    isActive,
  } as const;
};
