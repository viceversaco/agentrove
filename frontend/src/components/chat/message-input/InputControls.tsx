import { EnhanceButton } from './EnhanceButton';
import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { BranchSelector } from '@/components/chat/branch-selector/BranchSelector';
import { useInputState, useInputActions } from '@/hooks/useInputContext';

export function InputControls() {
  const state = useInputState();
  const actions = useInputActions();

  return (
    <div
      className="absolute bottom-2.5 left-3 right-20 flex items-center gap-1 sm:gap-1.5"
      onMouseDown={(e) => e.preventDefault()}
    >
      <EnhanceButton
        onEnhance={actions.handleEnhancePrompt}
        isEnhancing={state.isEnhancing}
        disabled={state.isLoading || !state.hasMessage}
      />

      <PermissionModeSelector
        chatId={state.chatId}
        dropdownPosition={state.dropdownPosition}
        disabled={state.isLoading}
      />

      <ThinkingModeSelector
        chatId={state.chatId}
        dropdownPosition={state.dropdownPosition}
        disabled={state.isLoading}
      />

      <ModelSelector
        selectedModelId={state.selectedModelId}
        onModelChange={actions.onModelChange}
        dropdownPosition={state.dropdownPosition}
        disabled={state.isLoading}
      />

      <BranchSelector dropdownPosition={state.dropdownPosition} disabled={state.isLoading} />
    </div>
  );
}
