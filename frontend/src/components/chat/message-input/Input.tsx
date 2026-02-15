import { memo } from 'react';
import { FileUploadDialog } from '@/components/ui/FileUploadDialog';
import { DrawingModal } from '@/components/ui/DrawingModal';
import { DropIndicator } from './DropIndicator';
import { SendButton } from './SendButton';
import { AttachButton } from './AttachButton';
import { Textarea } from './Textarea';
import { InputControls } from './InputControls';
import { InputAttachments } from './InputAttachments';
import { InputSuggestionsPanel } from './InputSuggestionsPanel';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { InputProvider } from './InputProvider';
import { useInputContext } from '@/hooks/useInputContext';
import type { ContextUsageInfo } from './ContextUsageIndicator';

export interface InputProps {
  message: string;
  setMessage: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onAttach?: (files: File[]) => void;
  attachedFiles?: File[] | null;
  isLoading: boolean;
  isStreaming?: boolean;
  onStopStream?: () => void;
  placeholder?: string;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  dropdownPosition?: 'top' | 'bottom';
  showAttachedFilesPreview?: boolean;
  contextUsage?: ContextUsageInfo;
  showTip?: boolean;
  compact?: boolean;
  chatId?: string;
  showLoadingSpinner?: boolean;
}

export const Input = memo(function Input(props: InputProps) {
  return (
    <InputProvider {...props}>
      <InputLayout />
    </InputProvider>
  );
});

function InputLayout() {
  const { state, actions, meta } = useInputContext();

  const shouldShowAttachedPreview =
    state.hasAttachments &&
    state.showPreview &&
    state.attachedFiles &&
    state.attachedFiles.length > 0;

  return (
    <form ref={meta.formRef} onSubmit={actions.handleSubmit} className="relative px-4 sm:px-6">
      <div
        {...meta.dragHandlers}
        className={`relative rounded-2xl border bg-surface-secondary shadow-soft transition-all duration-300 dark:bg-surface-dark-secondary ${
          state.isDragging
            ? 'scale-[1.01] border-border-hover dark:border-border-dark-hover'
            : 'border-border dark:border-border-dark'
        }`}
      >
        <DropIndicator visible={state.isDragging} fileType="any" message="Drop your files here" />

        {shouldShowAttachedPreview && (
          <InputAttachments
            files={state.attachedFiles!}
            previewUrls={state.previewUrls}
            onRemoveFile={actions.handleRemoveFile}
            onEditImage={actions.handleDrawClick}
          />
        )}

        {state.contextUsage && (
          <div className="absolute right-3 top-3 z-10">
            <ContextUsageIndicator usage={state.contextUsage} />
          </div>
        )}

        <div className="relative px-3 pb-12 pt-1.5 sm:pb-9">
          <Textarea
            ref={meta.textareaRef}
            message={state.message}
            setMessage={actions.setMessage}
            placeholder={state.placeholder}
            isLoading={state.isLoading}
            onKeyDown={actions.handleKeyDown}
            onCursorPositionChange={actions.setCursorPosition}
            compact={state.compact}
          />
          <InputSuggestionsPanel />
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-3 py-2 pb-safe">
          <div className="relative flex items-center justify-between">
            <InputControls />

            <div className="absolute bottom-2.5 right-3 flex items-center gap-1">
              <AttachButton
                onAttach={() => {
                  actions.resetDragState();
                  actions.setShowFileUpload(true);
                }}
              />
              <SendButton
                isLoading={state.isLoading}
                isStreaming={state.isStreaming}
                disabled={
                  (!state.isLoading && !state.isStreaming && !state.hasMessage) || state.isEnhancing
                }
                onClick={actions.handleSendClick}
                type="button"
                hasMessage={state.hasMessage}
                showLoadingSpinner={state.showLoadingSpinner}
              />
            </div>
          </div>
        </div>
      </div>

      <FileUploadDialog
        isOpen={state.showFileUpload}
        onClose={() => actions.setShowFileUpload(false)}
        onFileSelect={actions.handleFileSelect}
      />

      {state.editingImageIndex !== null &&
        state.editingImageIndex < state.previewUrls.length &&
        state.previewUrls[state.editingImageIndex] && (
          <DrawingModal
            imageUrl={state.previewUrls[state.editingImageIndex]}
            isOpen={state.showDrawingModal}
            onClose={actions.closeDrawingModal}
            onSave={actions.handleDrawingSave}
          />
        )}

      {state.showTip && !state.hasAttachments && (
        <div className="mt-1 animate-fade-in text-center text-2xs text-text-quaternary dark:text-text-dark-tertiary">
          <span className="font-medium">Tip:</span> Drag and drop images, pdfs and xlsx files into
          the input area, type `/` for slash commands, or `@` to mention files, agents, and prompts
        </div>
      )}
    </form>
  );
}
