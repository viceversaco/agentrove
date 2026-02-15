import { EnhanceButton } from './EnhanceButton';
import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { useInputState, useInputActions } from '@/hooks/useInputContext';

export function InputControls() {
  const state = useInputState();
  const actions = useInputActions();

  return (
    <div
      className="absolute bottom-2.5 left-3 right-20 flex flex-wrap items-center gap-1 sm:gap-1.5"
      onClick={(e) => e.preventDefault()}
    >
      <EnhanceButton
        onEnhance={actions.handleEnhancePrompt}
        isEnhancing={state.isEnhancing}
        disabled={state.isLoading || !state.hasMessage}
      />

      <PermissionModeSelector
        dropdownPosition={state.dropdownPosition}
        disabled={state.isLoading}
      />

      <ThinkingModeSelector dropdownPosition={state.dropdownPosition} disabled={state.isLoading} />

      <ModelSelector
        selectedModelId={state.selectedModelId}
        onModelChange={actions.onModelChange}
        dropdownPosition={state.dropdownPosition}
        disabled={state.isLoading}
      />
    </div>
  );
}
