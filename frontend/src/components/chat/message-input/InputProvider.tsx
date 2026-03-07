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
  placeholder = 'Message Agentrove\u2026',
  selectedModelId,
  onModelChange,
  dropdownPosition = 'top',
  showAttachedFilesPreview = true,
  contextUsage,
  showTip = true,
  compact = true,
  chatId,
  showLoadingSpinner = false,
  disabled = false,
  children,
}: InputProps & { children: ReactNode }) {
  const { fileStructure, customAgents, customSlashCommands, customPrompts } = useChatContext();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [activeMentions, setActiveMentions] = useState<MentionItem[]>([]);
  const messageRef = useRef(message);
  messageRef.current = message;
  const activeMentionsRef = useRef(activeMentions);
  activeMentionsRef.current = activeMentions;

  const prevChatId = useRef(chatId);
  if (prevChatId.current !== chatId) {
    prevChatId.current = chatId;
    if (activeMentions.length > 0) setActiveMentions([]);
  }

  const hasMessage = message.trim().length > 0 || activeMentions.length > 0;
  const hasAttachments = (attachedFiles?.length ?? 0) > 0;

  const prevHasAttachments = useRef(hasAttachments);
  if (prevHasAttachments.current !== hasAttachments) {
    prevHasAttachments.current = hasAttachments;
    setPreviewDismissed(false);
  }

  const showPreview = showAttachedFilesPreview && hasAttachments && !previewDismissed;

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
      const msg = messageRef.current;
      const beforeMention = msg.slice(0, mentionStartPos);
      const afterMention = msg.slice(mentionEndPos);
      const newMessage = `${beforeMention}${afterMention}`;

      setActiveMentions((prev) =>
        prev.some((m) => m.path === item.path) ? prev : [...prev, item],
      );
      setMessage(newMessage);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(mentionStartPos, mentionStartPos);
          setCursorPosition(mentionStartPos);
        }
      }, 0);
    },
    [setMessage],
  );

  const removeMention = useCallback((path: string) => {
    setActiveMentions((prev) => prev.filter((m) => m.path !== path));
  }, []);

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

  const buildMessageWithMentions = useCallback((text: string) => {
    const mentions = activeMentionsRef.current;
    if (mentions.length === 0) return text;
    const mentionPrefix = mentions.map((m) => `@${m.path}`).join(' ');
    return text.trim() ? `${mentionPrefix} ${text}` : mentionPrefix;
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (disabled) return;
      if (!hasMessage) return;

      setMessage(buildMessageWithMentions(messageRef.current));
      setActiveMentions([]);
      setPreviewDismissed(true);
      onSubmit(event);
    },
    [disabled, hasMessage, onSubmit, setMessage, buildMessageWithMentions],
  );

  const submitOrStop = useCallback(() => {
    if (isStreaming && !hasMessage) {
      onStopStream?.();
      return;
    }

    if (disabled) return;

    if (isStreaming && hasMessage && chatId) {
      const { permissionMode, thinkingMode } = useUIStore.getState();
      const fullMessage = buildMessageWithMentions(messageRef.current).trim();
      void useMessageQueueStore
        .getState()
        .queueMessage(
          chatId,
          fullMessage,
          selectedModelId,
          permissionMode,
          thinkingMode,
          attachedFiles ?? undefined,
        );
      setMessage('');
      setActiveMentions([]);
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
    disabled,
    hasMessage,
    isLoading,
    isStreaming,
    onStopStream,
    onSubmit,
    chatId,
    attachedFiles,
    setMessage,
    clearAttachedFiles,
    selectedModelId,
    buildMessageWithMentions,
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
    enhancePromptMutation.mutate({ prompt: messageRef.current.trim(), modelId: selectedModelId });
  }, [hasMessage, isEnhancing, selectedModelId, enhancePromptMutation]);

  const dynamicPlaceholder = isStreaming ? 'Type to queue message\u2026' : placeholder;

  const stateValue: InputState = useMemo(
    () => ({
      message,
      cursorPosition,
      isLoading,
      isDisabled: disabled,
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
      activeMentions,
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
      disabled,
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
      activeMentions,
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
      removeMention,
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
      removeMention,
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
