import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInView } from 'react-intersection-observer';
import { findLastBotMessageIndex } from '@/utils/message';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { PendingMessage } from '@/components/chat/message-bubble/PendingMessage';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import { LoadingIndicator } from './LoadingIndicator';
import { ScrollButton } from './ScrollButton';
import { ErrorMessage } from './ErrorMessage';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore, EMPTY_QUEUE } from '@/store/messageQueueStore';
import { ToolPermissionInline } from '@/components/chat/tools/ToolPermissionInline';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';

const SCROLL_THRESHOLD_PERCENT = 20;

export const Chat = memo(function Chat() {
  const { chatId } = useChatContext();
  const { state, actions } = useChatSessionContext();

  const {
    messages,
    pendingUserMessageId,
    isLoading,
    isStreaming,
    isInitialLoading,
    error,
    attachedFiles,
    selectedModelId,
    contextUsage,
    hasNextPage,
    isFetchingNextPage,
    pendingPermissionRequest,
    isPermissionLoading,
    permissionError,
  } = state;

  const {
    onSubmit,
    onStopStream,
    onAttach,
    onModelChange,
    onDismissError,
    fetchNextPage,
    onPermissionApprove,
    onPermissionReject,
  } = actions;

  const { inputMessage, setInputMessage } = useChatInputMessageContext();

  const streamingMessageIds = useStreamStore(
    useShallow((s) => {
      const ids: string[] = [];
      s.activeStreams.forEach((stream) => {
        if (stream.chatId === chatId && stream.isActive) {
          ids.push(stream.messageId);
        }
      });
      return ids;
    }),
  );
  const streamingMessageIdSet = useMemo(() => new Set(streamingMessageIds), [streamingMessageIds]);

  const pendingMessages = useMessageQueueStore((s) =>
    chatId ? (s.queues.get(chatId) ?? EMPTY_QUEUE) : EMPTY_QUEUE,
  );

  useEffect(() => {
    if (chatId) {
      void useMessageQueueStore.getState().fetchQueue(chatId);
    }
  }, [chatId]);

  const handleCancelPending = useCallback(() => {
    if (chatId) {
      useMessageQueueStore.getState().clearAndSync(chatId);
    }
  }, [chatId]);

  const handleEditPending = useCallback(
    (newContent: string) => {
      if (chatId) {
        useMessageQueueStore.getState().updateQueuedMessage(chatId, newContent);
      }
    },
    [chatId],
  );

  const chatWindowRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadMoreTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasScrolledToBottom = useRef(false);
  const prevScrollHeight = useRef<number>(0);
  const prevContentHeight = useRef<number>(0);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    hasScrolledToBottom.current = false;
    prevScrollHeight.current = 0;
    isNearBottomRef.current = true;
  }, [chatId]);

  const { ref: loadMoreRef, inView } = useInView();

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage && fetchNextPage) {
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current);
      }

      loadMoreTimeoutRef.current = setTimeout(() => {
        if (!isFetchingNextPage) {
          if (chatWindowRef.current) {
            prevScrollHeight.current = chatWindowRef.current.scrollHeight;
          }
          fetchNextPage();
        }
      }, 100);
    }

    return () => {
      if (loadMoreTimeoutRef.current) {
        clearTimeout(loadMoreTimeoutRef.current);
      }
    };
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useLayoutEffect(() => {
    const container = chatWindowRef.current;
    if (container && prevScrollHeight.current > 0 && !isInitialLoading) {
      const scrollDiff = container.scrollHeight - prevScrollHeight.current;
      if (scrollDiff > 0) {
        container.scrollTop += scrollDiff;
      }
      prevScrollHeight.current = 0;
    }
  }, [messages.length, isInitialLoading]);

  useLayoutEffect(() => {
    const container = chatWindowRef.current;
    if (container && !isInitialLoading && messages.length > 0 && !hasScrolledToBottom.current) {
      if (messages[0]?.chat_id !== chatId) return;
      container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
      hasScrolledToBottom.current = true;
    }
  }, [chatId, isInitialLoading, messages]);

  useEffect(() => {
    if (isStreaming && isNearBottomRef.current && chatWindowRef.current) {
      chatWindowRef.current.scrollTo({
        top: chatWindowRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [isStreaming, messages]);

  const scrollToBottom = useCallback(() => {
    const container = chatWindowRef.current;
    if (container) {
      setShowScrollButton(false);

      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  const checkIfNearBottom = useCallback(() => {
    const container = chatWindowRef.current;
    if (!container) return false;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const thresholdPixels = (clientHeight * SCROLL_THRESHOLD_PERCENT) / 100;

    return distanceFromBottom <= thresholdPixels;
  }, []);

  const handleScroll = useCallback(() => {
    const container = chatWindowRef.current;
    if (!container) return;

    const isAtBottom = checkIfNearBottom();
    isNearBottomRef.current = isAtBottom;
    const shouldShow = !isAtBottom;

    setShowScrollButton((prev) => {
      if (prev === shouldShow) return prev;
      return shouldShow;
    });

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, [checkIfNearBottom]);

  useEffect(() => {
    const container = chatWindowRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();

      const currentTimeoutRef = timeoutRef.current;

      return () => {
        if (currentTimeoutRef) {
          clearTimeout(currentTimeoutRef);
        }
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, [handleScroll]);

  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    const scrollContainer = chatWindowRef.current;
    if (!messagesContainer || !scrollContainer) return;

    prevContentHeight.current = messagesContainer.getBoundingClientRect().height;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        const heightIncreased = newHeight > prevContentHeight.current;

        if (heightIncreased && isNearBottomRef.current) {
          if (autoScrollTimeoutRef.current) {
            clearTimeout(autoScrollTimeoutRef.current);
          }
          autoScrollTimeoutRef.current = setTimeout(() => {
            scrollContainer.scrollTo({
              top: scrollContainer.scrollHeight,
              behavior: 'smooth',
            });
          }, 100);
        }

        prevContentHeight.current = newHeight;
      }
    });

    resizeObserver.observe(messagesContainer);
    return () => {
      resizeObserver.disconnect();
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current);
      }
    };
  }, [isInitialLoading, messages.length]);

  const lastBotMessageIndex = useMemo(() => findLastBotMessageIndex(messages), [messages]);
  const latestUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].is_bot) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages]);

  const canShowPermissionInline =
    pendingPermissionRequest &&
    pendingPermissionRequest.tool_name !== 'AskUserQuestion' &&
    pendingPermissionRequest.tool_name !== 'ExitPlanMode';
  const lastBotMessage = lastBotMessageIndex >= 0 ? messages[lastBotMessageIndex] : undefined;
  const lastBotIsStreaming = !!lastBotMessage && streamingMessageIdSet.has(lastBotMessage.id);
  const showPermissionAtEnd =
    canShowPermissionInline && (lastBotMessageIndex < 0 || lastBotIsStreaming);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div
        ref={chatWindowRef}
        className="scrollbar-thin scrollbar-thumb-border-secondary dark:scrollbar-thumb-border-dark hover:scrollbar-thumb-text-quaternary dark:hover:scrollbar-thumb-border-dark-hover scrollbar-track-transparent flex-1 overflow-y-auto overflow-x-hidden"
      >
        {isInitialLoading && messages.length === 0 ? (
          <ChatSkeleton messageCount={3} className="py-4" />
        ) : (
          <div ref={messagesContainerRef} className="w-full lg:mx-auto lg:max-w-3xl">
            {hasNextPage && (
              <div ref={loadMoreRef} className="flex h-4 items-center justify-center p-4">
                {isFetchingNextPage && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-dark-secondary">
                    <Spinner size="xs" />
                    Loading older messages...
                  </div>
                )}
              </div>
            )}
            {messages.map((msg, index) => {
              const messageIsStreaming = streamingMessageIdSet.has(msg.id);
              const isBotMessage = msg.is_bot ?? msg.role === 'assistant';
              const isLastBotMessage = isBotMessage && index === lastBotMessageIndex;
              const showPermissionAfterThis =
                isLastBotMessage && !messageIsStreaming && canShowPermissionInline;
              const localAttachmentIds =
                msg.attachments?.reduce<string[]>((acc, attachment) => {
                  if (isBrowserObjectUrl(attachment.file_url)) acc.push(attachment.id);
                  return acc;
                }, []) ?? [];
              const isLatestUserMessage = !isBotMessage && msg.id === latestUserMessageId;
              const shouldShowUploadingOverlay =
                localAttachmentIds.length > 0 &&
                (pendingUserMessageId === msg.id ||
                  (isLatestUserMessage && (pendingUserMessageId !== null || isLoading)));
              const uploadingAttachmentIds = shouldShowUploadingOverlay
                ? localAttachmentIds
                : undefined;

              return (
                <React.Fragment key={msg.id}>
                  <div className="message-item">
                    {isBotMessage ? (
                      <AssistantMessage
                        id={msg.id}
                        contentText={msg.content_text}
                        contentRender={msg.content_render}
                        attachments={msg.attachments}
                        isStreaming={messageIsStreaming}
                        createdAt={msg.created_at}
                        modelId={msg.model_id}
                        isLastBotMessageWithCommit={isLastBotMessage}
                        isLastBotMessage={isLastBotMessage && !messageIsStreaming}
                      />
                    ) : (
                      <UserMessage
                        contentRender={msg.content_render}
                        attachments={msg.attachments}
                        uploadingAttachmentIds={uploadingAttachmentIds}
                        isStreaming={messageIsStreaming}
                      />
                    )}
                  </div>
                  {showPermissionAfterThis && (
                    <div className="px-4 sm:px-6">
                      <div className="flex items-start gap-3 sm:gap-4">
                        <div className="h-8 w-8 flex-shrink-0" />
                        <div className="mb-3 mt-1 min-w-0 flex-1">
                          <ToolPermissionInline
                            request={pendingPermissionRequest}
                            onApprove={onPermissionApprove}
                            onReject={onPermissionReject}
                            isLoading={isPermissionLoading}
                            error={permissionError}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {showPermissionAtEnd && pendingPermissionRequest && (
              <div className="px-4 sm:px-6">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="h-8 w-8 flex-shrink-0" />
                  <div className="mb-3 mt-1 min-w-0 flex-1">
                    <ToolPermissionInline
                      request={pendingPermissionRequest}
                      onApprove={onPermissionApprove}
                      onReject={onPermissionReject}
                      isLoading={isPermissionLoading}
                      error={permissionError}
                    />
                  </div>
                </div>
              </div>
            )}
            {pendingMessages.map((pending) => (
              <PendingMessage
                key={pending.id}
                message={pending}
                onCancel={handleCancelPending}
                onEdit={handleEditPending}
              />
            ))}
            {error && <ErrorMessage error={error} onDismiss={onDismissError} />}
          </div>
        )}
      </div>
      <div className="relative">
        {isStreaming && (
          <div className="sticky bottom-full z-10 w-full">
            <LoadingIndicator />
          </div>
        )}

        {showScrollButton && <ScrollButton onClick={scrollToBottom} />}

        <div className="relative bg-surface pb-safe dark:bg-surface-dark">
          <div className="w-full py-2 lg:mx-auto lg:max-w-3xl">
            <Input
              message={inputMessage}
              setMessage={setInputMessage}
              onSubmit={onSubmit}
              onAttach={onAttach}
              attachedFiles={attachedFiles}
              isLoading={isLoading}
              isStreaming={isStreaming}
              onStopStream={onStopStream}
              selectedModelId={selectedModelId}
              onModelChange={onModelChange}
              dropdownPosition="top"
              showAttachedFilesPreview={true}
              contextUsage={contextUsage}
              showTip={false}
              chatId={chatId}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
