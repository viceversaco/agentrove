import { memo } from 'react';
import { SlashCommandsPanel } from './SlashCommandsPanel';
import { MentionSuggestionsPanel } from './MentionSuggestionsPanel';
import { useInputContext } from '@/hooks/useInputContext';

export const InputSuggestionsPanel = memo(function InputSuggestionsPanel() {
  const { state, actions } = useInputContext();

  if (state.isMentionActive) {
    return (
      <MentionSuggestionsPanel
        files={state.filteredFiles}
        agents={state.filteredAgents}
        prompts={state.filteredPrompts}
        highlightedIndex={state.highlightedMentionIndex}
        onSelect={actions.selectMention}
      />
    );
  }

  return (
    <SlashCommandsPanel
      suggestions={state.slashCommandSuggestions}
      highlightedIndex={state.highlightedSlashCommandIndex}
      onSelect={actions.selectSlashCommand}
    />
  );
});
