import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  type ReactNode,
} from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { PendingMessage } from '@/components/chat/message-bubble/PendingMessage';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import { ScrollButton } from './ScrollButton';
import { ThinkingIndicator } from './ThinkingIndicator';
import { ErrorMessage } from './ErrorMessage';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore, EMPTY_QUEUE } from '@/store/messageQueueStore';
import { ToolPermissionInline } from '@/components/chat/tools/ToolPermissionInline';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';

const SCROLL_THRESHOLD_PERCENT = 20;
const INITIAL_FIRST_ITEM_INDEX = 1_000_000;
const TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER = 1.5;

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

  const activeStreams = useStreamStore((streamState) => streamState.activeStreams);
  const streamIdByChatMessage = useStreamStore((streamState) => streamState.streamIdByChatMessage);
  const streamingMessageIdSet = useMemo(() => {
    const ids = new Set<string>();
    if (!chatId) return ids;

    for (const streamId of streamIdByChatMessage.values()) {
      const stream = activeStreams.get(streamId);
      if (stream?.chatId === chatId && stream.isActive) {
        ids.add(stream.messageId);
      }
    }

    return ids;
  }, [activeStreams, chatId, streamIdByChatMessage]);

  const pendingMessages = useMessageQueueStore((storeState) =>
    chatId ? (storeState.queues.get(chatId) ?? EMPTY_QUEUE) : EMPTY_QUEUE,
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

  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const hasScrolledToBottom = useRef(false);
  const isNearBottomRef = useRef(true);
  const allowTopPaginationRef = useRef(false);
  const lastScrollTopRef = useRef<number | null>(null);
  const lastPaginatedMessageIdRef = useRef<string | null>(null);
  const previousMessagesRef = useRef(messages);

  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollerElement, setScrollerElement] = useState<HTMLElement | null>(null);
  const listHeaderRef = useRef<ReactNode>(null);
  const listFooterRef = useRef<ReactNode>(null);

  useEffect(() => {
    hasScrolledToBottom.current = false;
    isNearBottomRef.current = true;
    allowTopPaginationRef.current = false;
    lastScrollTopRef.current = null;
    lastPaginatedMessageIdRef.current = null;
    setShowScrollButton(false);
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX);
    previousMessagesRef.current = [];
  }, [chatId]);

  useEffect(() => {
    if (chatId && messages.length > 0 && messages[0]?.chat_id !== chatId) {
      return;
    }

    const currentMessages = messages;
    const previousMessages = previousMessagesRef.current;

    if (previousMessages.length === 0) {
      previousMessagesRef.current = currentMessages;
      return;
    }

    const firstMessageId = currentMessages[0]?.id;
    const previousFirstMessageId = previousMessages[0]?.id;

    if (firstMessageId !== previousFirstMessageId) {
      const previousFirstIndexInCurrent =
        previousFirstMessageId !== undefined
          ? currentMessages.findIndex((message) => message.id === previousFirstMessageId)
          : -1;

      if (previousFirstIndexInCurrent > 0) {
        setFirstItemIndex((currentIndex) => currentIndex - previousFirstIndexInCurrent);
      } else {
        const currentFirstIndexInPrevious =
          firstMessageId !== undefined
            ? previousMessages.findIndex((message) => message.id === firstMessageId)
            : -1;
        if (currentFirstIndexInPrevious > 0) {
          setFirstItemIndex((currentIndex) => currentIndex + currentFirstIndexInPrevious);
        }
      }

      lastPaginatedMessageIdRef.current = null;
    }

    previousMessagesRef.current = currentMessages;
  }, [chatId, messages]);

  const setVirtualScrollerRef = useCallback((ref: HTMLElement | null | Window) => {
    if (ref instanceof HTMLElement) {
      scrollerRef.current = ref;
      lastScrollTopRef.current = ref.scrollTop;
      setScrollerElement(ref);
      return;
    }

    scrollerRef.current = null;
    lastScrollTopRef.current = null;
    setScrollerElement(null);
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;

    if (!hasScrolledToBottom.current) {
      lastScrollTopRef.current = scrollTop;
      return;
    }

    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const thresholdPixels = (clientHeight * SCROLL_THRESHOLD_PERCENT) / 100;
    const isAtBottom = distanceFromBottom <= thresholdPixels;
    isNearBottomRef.current = isAtBottom;
    const isScrollingUp = lastScrollTopRef.current !== null && scrollTop < lastScrollTopRef.current;
    const isNearTop = scrollTop <= clientHeight * TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER;

    if (!allowTopPaginationRef.current && isScrollingUp && isNearTop && !isAtBottom) {
      allowTopPaginationRef.current = true;
    }

    lastScrollTopRef.current = scrollTop;
    setShowScrollButton(!isAtBottom);
  }, []);

  useEffect(() => {
    if (!scrollerElement) return;

    scrollerElement.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      scrollerElement.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll, scrollerElement]);

  useLayoutEffect(() => {
    if (isInitialLoading || messages.length === 0 || hasScrolledToBottom.current) {
      return;
    }

    if (messages[0]?.chat_id !== chatId) {
      return;
    }

    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'auto',
    });

    hasScrolledToBottom.current = true;
    handleScroll();
  }, [chatId, handleScroll, isInitialLoading, messages]);

  const scrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth',
    });
  }, []);

  const followOutput = useCallback(
    (isAtBottom: boolean) => {
      if (isStreaming && (isAtBottom || isNearBottomRef.current)) {
        return 'smooth';
      }

      return false;
    },
    [isStreaming],
  );

  const handleStartReached = useCallback(() => {
    if (
      !allowTopPaginationRef.current ||
      !hasScrolledToBottom.current ||
      !hasNextPage ||
      isFetchingNextPage ||
      !fetchNextPage
    ) {
      return;
    }

    const firstMessageId = messages[0]?.id;
    if (!firstMessageId || lastPaginatedMessageIdRef.current === firstMessageId) {
      return;
    }

    allowTopPaginationRef.current = false;
    lastPaginatedMessageIdRef.current = firstMessageId;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, messages]);

  const { lastBotMessage, latestUserMessageId } = useMemo(() => {
    let latestAssistantMessage: (typeof messages)[number] | undefined;
    let latestUserId: string | null = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const isAssistantMessage = message.is_bot ?? message.role === 'assistant';

      if (!latestAssistantMessage && isAssistantMessage) {
        latestAssistantMessage = message;
      }

      if (latestUserId === null && !isAssistantMessage) {
        latestUserId = message.id;
      }

      if (latestAssistantMessage && latestUserId !== null) {
        break;
      }
    }

    return {
      lastBotMessage: latestAssistantMessage,
      latestUserMessageId: latestUserId,
    };
  }, [messages]);

  const lastBotMessageId = lastBotMessage?.id ?? null;

  const canShowPermissionInline =
    pendingPermissionRequest &&
    pendingPermissionRequest.tool_name !== 'AskUserQuestion' &&
    pendingPermissionRequest.tool_name !== 'ExitPlanMode';
  const lastBotIsStreaming = !!lastBotMessageId && streamingMessageIdSet.has(lastBotMessageId);
  const lastBotHasContent =
    !!lastBotMessage &&
    ((lastBotMessage.content_render?.events?.length ?? 0) > 0 || !!lastBotMessage.content_text);
  const showPermissionAtEnd = canShowPermissionInline && (!lastBotMessageId || lastBotIsStreaming);

  const renderMessage = useCallback(
    (_index: number, msg: (typeof messages)[number]) => {
      const messageIsStreaming = streamingMessageIdSet.has(msg.id);
      const isBotMessage = msg.is_bot ?? msg.role === 'assistant';
      const isLastBotMessage = isBotMessage && msg.id === lastBotMessageId;
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
      const uploadingAttachmentIds = shouldShowUploadingOverlay ? localAttachmentIds : undefined;

      return (
        <div className="w-full lg:mx-auto lg:max-w-3xl">
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
          {showPermissionAfterThis && pendingPermissionRequest && (
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
        </div>
      );
    },
    [
      canShowPermissionInline,
      isLoading,
      isPermissionLoading,
      lastBotMessageId,
      latestUserMessageId,
      onPermissionApprove,
      onPermissionReject,
      pendingPermissionRequest,
      pendingUserMessageId,
      permissionError,
      streamingMessageIdSet,
    ],
  );

  const listHeader = useMemo(() => {
    if (!hasNextPage) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-3xl">
        <div className="flex h-4 items-center justify-center p-4">
          {isFetchingNextPage && (
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-dark-secondary">
              <Spinner size="xs" />
              Loading older messages...
            </div>
          )}
        </div>
      </div>
    );
  }, [hasNextPage, isFetchingNextPage]);

  const showThinking = isLoading || (isStreaming && !lastBotHasContent);

  const listFooter = useMemo(() => {
    if (!showThinking && !showPermissionAtEnd && pendingMessages.length === 0 && !error) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-3xl">
        {showThinking && <ThinkingIndicator />}
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
    );
  }, [
    error,
    handleCancelPending,
    handleEditPending,
    isPermissionLoading,
    onDismissError,
    onPermissionApprove,
    onPermissionReject,
    pendingMessages,
    pendingPermissionRequest,
    permissionError,
    showPermissionAtEnd,
    showThinking,
  ]);

  listHeaderRef.current = listHeader;
  listFooterRef.current = listFooter;

  const virtuosoComponents = useRef({
    Header: () => <>{listHeaderRef.current}</>,
    Footer: () => <>{listFooterRef.current}</>,
  }).current;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-hidden">
        {isInitialLoading && messages.length === 0 ? (
          <ChatSkeleton messageCount={3} className="py-4" />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="scrollbar-thin scrollbar-thumb-border-secondary dark:scrollbar-thumb-border-dark hover:scrollbar-thumb-text-quaternary dark:hover:scrollbar-thumb-border-dark-hover scrollbar-track-transparent h-full overflow-y-auto overflow-x-hidden"
            data={messages}
            firstItemIndex={firstItemIndex}
            computeItemKey={(_index, msg) => msg.id}
            itemContent={renderMessage}
            startReached={handleStartReached}
            followOutput={followOutput}
            scrollerRef={setVirtualScrollerRef}
            components={virtuosoComponents}
          />
        )}
      </div>
      <div className="relative">
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
