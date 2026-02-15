import { useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { useEnhancePromptMutation } from '@/hooks/queries/useChatQueries';
import { useMentionSuggestions } from '@/hooks/useMentionSuggestions';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useUIStore } from '@/store/uiStore';
import { useChatContext } from '@/hooks/useChatContext';
import {
  InputContext,
  InputStateContext,
  InputActionsContext,
  InputMetaContext,
  type InputState,
  type InputActions,
  type InputMeta,
  type InputContextValue,
} from './InputContext';
import type { InputProps } from './Input';
import type { MentionItem, SlashCommand } from '@/types/ui.types';

export function InputProvider({
  message,
  setMessage,
  onSubmit,
  onAttach,
  attachedFiles = null,
  isLoading,
  isStreaming = false,
  onStopStream,
  placeholder = 'Message Claudex...',
  selectedModelId,
  onModelChange,
  dropdownPosition = 'top',
  showAttachedFilesPreview = true,
  contextUsage,
  showTip = true,
  compact = true,
  chatId,
  showLoadingSpinner = false,
  children,
}: InputProps & { children: ReactNode }) {
  const { fileStructure, customAgents, customSlashCommands, customPrompts } = useChatContext();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);

  const hasMessage = message.trim().length > 0;
  const hasAttachments = (attachedFiles?.length ?? 0) > 0;

  const prevHasAttachments = useRef(hasAttachments);
  if (prevHasAttachments.current !== hasAttachments) {
    prevHasAttachments.current = hasAttachments;
    setPreviewDismissed(false);
  }

  const showPreview = showAttachedFilesPreview && hasAttachments && !previewDismissed;

  const queueMessage = useMessageQueueStore((state) => state.queueMessage);
  const permissionMode = useUIStore((state) => state.permissionMode);
  const thinkingMode = useUIStore((state) => state.thinkingMode);
  const clearAttachedFiles = onAttach;

  const { previewUrls } = useFileHandling({
    initialFiles: attachedFiles,
  });

  const {
    showFileUpload,
    setShowFileUpload,
    showDrawingModal,
    editingImageIndex,
    handleFileSelect,
    handleRemoveFile,
    handleDrawClick,
    handleDrawingSave,
    handleDroppedFiles,
    closeDrawingModal,
  } = useInputFileOperations({
    attachedFiles,
    onAttach,
  });

  const { isDragging, dragHandlers, resetDragState } = useDragAndDrop({
    onFilesDrop: handleDroppedFiles,
  });

  const focusTextarea = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        const length = text.length;
        textarea.setSelectionRange(length, length);
      }, 0);
    }
  }, []);

  const enhancePromptMutation = useEnhancePromptMutation({
    onSuccess: (enhancedPrompt) => {
      setMessage(enhancedPrompt);
      focusTextarea(enhancedPrompt);
    },
  });

  const isEnhancing = enhancePromptMutation.isPending;

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand) => {
      setPreviewDismissed(true);
      const newMessage = `${command.value} `;
      setMessage(newMessage);
      focusTextarea(newMessage);
    },
    [setMessage, focusTextarea],
  );

  const {
    filteredCommands: slashCommandSuggestions,
    highlightedIndex: highlightedSlashCommandIndex,
    selectCommand: selectSlashCommand,
    handleKeyDown: handleSlashCommandKeyDown,
  } = useSlashCommandSuggestions({
    message,
    onSelect: handleSlashCommandSelect,
    customSlashCommands,
  });

  const handleMentionSelect = useCallback(
    (item: MentionItem, mentionStartPos: number, mentionEndPos: number) => {
      const beforeMention = message.slice(0, mentionStartPos);
      const afterMention = message.slice(mentionEndPos);
      const newMessage = `${beforeMention}@${item.path} ${afterMention}`;
      const newCursorPos = mentionStartPos + item.path.length + 2;

      setMessage(newMessage);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          setCursorPosition(newCursorPos);
        }
      }, 0);
    },
    [message, setMessage],
  );

  const {
    filteredFiles,
    filteredAgents,
    filteredPrompts,
    highlightedIndex: highlightedMentionIndex,
    selectItem: selectMention,
    handleKeyDown: handleMentionKeyDown,
    isActive: isMentionActive,
  } = useMentionSuggestions({
    message,
    cursorPosition: cursorPosition,
    fileStructure,
    customAgents,
    customPrompts,
    onSelect: handleMentionSelect,
  });

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!hasMessage) return;

      setPreviewDismissed(true);
      onSubmit(event);
    },
    [hasMessage, onSubmit],
  );

  const submitOrStop = useCallback(() => {
    if (isStreaming && !hasMessage) {
      onStopStream?.();
      return;
    }

    if (isStreaming && hasMessage && chatId) {
      void queueMessage(
        chatId,
        message.trim(),
        selectedModelId,
        permissionMode,
        thinkingMode,
        attachedFiles ?? undefined,
      );
      setMessage('');
      clearAttachedFiles?.([]);
      setPreviewDismissed(true);
      return;
    }

    if (isLoading) {
      onStopStream?.();
      return;
    }

    if (!hasMessage) return;

    setPreviewDismissed(true);

    const formElement = formRef.current;
    if (formElement && typeof formElement.requestSubmit === 'function') {
      formElement.requestSubmit();
      return;
    }

    const formEvent = new Event('submit', {
      bubbles: true,
      cancelable: true,
    }) as unknown as React.FormEvent;
    onSubmit(formEvent);
  }, [
    hasMessage,
    isLoading,
    isStreaming,
    onStopStream,
    onSubmit,
    chatId,
    message,
    attachedFiles,
    queueMessage,
    setMessage,
    clearAttachedFiles,
    selectedModelId,
    permissionMode,
    thinkingMode,
  ]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<Element>) => {
      const handledByMentions = handleMentionKeyDown(event);
      if (handledByMentions) return;

      const handledBySlashCommands = handleSlashCommandKeyDown(event);
      if (handledBySlashCommands) return;

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitOrStop();
      }
    },
    [handleMentionKeyDown, handleSlashCommandKeyDown, submitOrStop],
  );

  const handleSendClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      submitOrStop();
    },
    [submitOrStop],
  );

  const handleEnhancePrompt = useCallback(() => {
    if (!hasMessage || isEnhancing) return;
    enhancePromptMutation.mutate({ prompt: message.trim(), modelId: selectedModelId });
  }, [hasMessage, isEnhancing, message, selectedModelId, enhancePromptMutation]);

  const dynamicPlaceholder = isStreaming ? 'Type to queue message...' : placeholder;

  const stateValue: InputState = useMemo(
    () => ({
      message,
      cursorPosition,
      isLoading,
      isStreaming,
      isEnhancing,
      hasMessage,
      hasAttachments,
      showPreview,
      showFileUpload,
      showDrawingModal,
      showLoadingSpinner,
      showTip,
      isDragging,
      compact,
      placeholder: dynamicPlaceholder,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      previewUrls,
      editingImageIndex,
      contextUsage,
      chatId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      filteredAgents,
      filteredPrompts,
      highlightedMentionIndex,
    }),
    [
      message,
      cursorPosition,
      isLoading,
      isStreaming,
      isEnhancing,
      hasMessage,
      hasAttachments,
      showPreview,
      showFileUpload,
      showDrawingModal,
      showLoadingSpinner,
      showTip,
      isDragging,
      compact,
      dynamicPlaceholder,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      previewUrls,
      editingImageIndex,
      contextUsage,
      chatId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      filteredAgents,
      filteredPrompts,
      highlightedMentionIndex,
    ],
  );

  const actionsValue: InputActions = useMemo(
    () => ({
      setMessage,
      setCursorPosition,
      setShowFileUpload,
      onModelChange,
      handleSubmit,
      submitOrStop,
      handleKeyDown,
      handleSendClick,
      handleEnhancePrompt,
      handleFileSelect,
      handleRemoveFile,
      handleDrawClick,
      handleDrawingSave,
      closeDrawingModal,
      resetDragState,
      selectSlashCommand,
      selectMention,
    }),
    [
      setMessage,
      setCursorPosition,
      setShowFileUpload,
      onModelChange,
      handleSubmit,
      submitOrStop,
      handleKeyDown,
      handleSendClick,
      handleEnhancePrompt,
      handleFileSelect,
      handleRemoveFile,
      handleDrawClick,
      handleDrawingSave,
      closeDrawingModal,
      resetDragState,
      selectSlashCommand,
      selectMention,
    ],
  );

  const metaValue: InputMeta = useMemo(
    () => ({
      formRef,
      textareaRef,
      dragHandlers,
    }),
    [dragHandlers],
  );

  const value: InputContextValue = useMemo(
    () => ({ state: stateValue, actions: actionsValue, meta: metaValue }),
    [stateValue, actionsValue, metaValue],
  );

  return (
    <InputContext.Provider value={value}>
      <InputStateContext.Provider value={stateValue}>
        <InputActionsContext.Provider value={actionsValue}>
          <InputMetaContext.Provider value={metaValue}>{children}</InputMetaContext.Provider>
        </InputActionsContext.Provider>
      </InputStateContext.Provider>
    </InputContext.Provider>
  );
}
