import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/utils/logger';
import { createAttachmentsFromFiles } from '@/utils/message';
import { extractPromptMention } from '@/utils/mentionParser';
import { MAX_MESSAGE_SIZE_BYTES } from '@/config/constants';
import type { ChatRequest, Message, StreamState } from '@/types';

interface UseMessageActionsParams {
  chatId: string | undefined;
  selectedModelId: string | null | undefined;
  permissionMode: 'plan' | 'ask' | 'auto';
  thinkingMode: string | null | undefined;
  setStreamState: (state: StreamState) => void;
  setCurrentMessageId: (id: string | null) => void;
  setError: (error: Error | null) => void;
  setWasAborted: (aborted: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  addMessageToCache: (message: Message, userMessage?: Message) => void;
  startStream: (request: ChatRequest) => Promise<string>;
  storeBlobUrl: (file: File, url: string) => void;
  setPendingUserMessageId: (id: string | null) => void;
  isLoading: boolean;
  isStreaming: boolean;
}

const isEmptyBotPlaceholder = (msg?: Message) =>
  !!msg?.is_bot &&
  (!msg?.content_render?.events || msg.content_render.events.length === 0) &&
  !msg.content_text;

export function useMessageActions({
  chatId,
  selectedModelId,
  permissionMode,
  thinkingMode,
  setStreamState,
  setCurrentMessageId,
  setError,
  setWasAborted,
  setMessages,
  addMessageToCache,
  startStream,
  storeBlobUrl,
  setPendingUserMessageId,
  isLoading,
  isStreaming,
}: UseMessageActionsParams) {
  const sendMessage = useCallback(
    async (
      prompt: string,
      chatIdOverride?: string,
      userMessage?: Message,
      filesToSend?: File[],
    ) => {
      const normalizedPrompt = prompt.trim();
      if (!normalizedPrompt) return;

      if (!selectedModelId?.trim()) {
        setError(new Error('Please select an AI model'));
        setStreamState('error');
        return;
      }

      setStreamState('loading');
      setCurrentMessageId(null);
      setError(null);
      setWasAborted(false);
      if (filesToSend && filesToSend.length > 0 && userMessage?.id) {
        setPendingUserMessageId(userMessage.id);
      }

      try {
        const { promptName, cleanedMessage } = extractPromptMention(normalizedPrompt);

        const request: ChatRequest = {
          prompt: cleanedMessage || normalizedPrompt,
          model_id: selectedModelId,
          ...(chatIdOverride && { chat_id: chatIdOverride }),
          attached_files: filesToSend && filesToSend.length > 0 ? filesToSend : undefined,
          permission_mode: permissionMode,
          thinking_mode: thinkingMode || undefined,
          ...(promptName && { selected_prompt_name: promptName }),
        };

        const messageId = await startStream(request);

        setCurrentMessageId(messageId);
        setStreamState('streaming');

        const initialMessage: Message = {
          id: messageId,
          chat_id: chatIdOverride ?? chatId ?? '',
          content_text: '',
          content_render: { events: [] },
          last_seq: 0,
          active_stream_id: null,
          stream_status: 'in_progress',
          role: 'assistant',
          is_bot: true,
          attachments: [],
          created_at: new Date().toISOString(),
          model_id: selectedModelId ?? undefined,
        };

        setMessages((prev) => {
          const lastMessage = prev[prev.length - 1];
          if (isEmptyBotPlaceholder(lastMessage)) {
            return [...prev.slice(0, -1), initialMessage];
          }
          return [...prev, initialMessage];
        });
        addMessageToCache(initialMessage, userMessage);
      } catch (streamStartError) {
        setPendingUserMessageId(null);
        setStreamState('error');
        const error =
          streamStartError instanceof Error
            ? streamStartError
            : new Error('Failed to start stream');
        setError(error);
        throw error;
      }
    },
    [
      chatId,
      addMessageToCache,
      permissionMode,
      selectedModelId,
      startStream,
      thinkingMode,
      setStreamState,
      setCurrentMessageId,
      setError,
      setWasAborted,
      setMessages,
      setPendingUserMessageId,
    ],
  );

  const handleMessageSend = useCallback(
    async (inputMessage: string, inputFiles: File[]) => {
      const hasContent = inputMessage.trim();

      if (!hasContent || isLoading || isStreaming) return;

      if (!selectedModelId?.trim()) {
        setError(new Error('Please select an AI model'));
        return;
      }

      const prompt = inputMessage;

      const encoder = new TextEncoder();
      const byteSize = encoder.encode(prompt).length;

      if (byteSize > MAX_MESSAGE_SIZE_BYTES) {
        toast.error(`Message too large (${Math.round(byteSize / 1024)}KB).`);
        return;
      }

      const newMessage: Message = {
        id: crypto.randomUUID(),
        chat_id: chatId ?? '',
        content_text: prompt,
        content_render: {
          events: [{ type: 'user_text', text: prompt }],
        },
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'completed',
        role: 'user',
        is_bot: false,
        model_id: selectedModelId,
        created_at: new Date().toISOString(),
        attachments: createAttachmentsFromFiles(inputFiles, storeBlobUrl),
      };

      setMessages((prev) => [...prev, newMessage]);
      setPendingUserMessageId(newMessage.id);

      try {
        await sendMessage(newMessage.content_text, chatId, newMessage, inputFiles);
        return { success: true };
      } catch (error) {
        logger.error('Failed to send message', 'useMessageActions', error);
        setMessages((prev) => prev.filter((msg) => msg.id !== newMessage.id));
        setPendingUserMessageId(null);
        return { success: false };
      }
    },
    [
      chatId,
      isLoading,
      isStreaming,
      selectedModelId,
      sendMessage,
      storeBlobUrl,
      setPendingUserMessageId,
      setError,
      setMessages,
    ],
  );

  return {
    sendMessage,
    handleMessageSend,
  };
}
