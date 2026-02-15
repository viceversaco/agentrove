import { type ReactNode, useMemo } from 'react';
import { ChatInputMessageContext } from './ChatInputMessageContextDefinition';

interface ChatInputMessageProviderProps {
  inputMessage: string;
  setInputMessage: (msg: string) => void;
  children: ReactNode;
}

export function ChatInputMessageProvider({
  inputMessage,
  setInputMessage,
  children,
}: ChatInputMessageProviderProps) {
  const value = useMemo(() => ({ inputMessage, setInputMessage }), [inputMessage, setInputMessage]);
  return (
    <ChatInputMessageContext.Provider value={value}>{children}</ChatInputMessageContext.Provider>
  );
}
