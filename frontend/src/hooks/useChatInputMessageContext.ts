import { use } from 'react';
import { ChatInputMessageContext } from '@/contexts/ChatInputMessageContextDefinition';

export function useChatInputMessageContext() {
  const context = use(ChatInputMessageContext);
  if (!context) {
    throw new Error('useChatInputMessageContext must be used within a ChatInputMessageProvider');
  }
  return context;
}
