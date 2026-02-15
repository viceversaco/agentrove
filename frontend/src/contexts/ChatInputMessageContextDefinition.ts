import { createContext } from 'react';

export interface ChatInputMessageContextValue {
  inputMessage: string;
  setInputMessage: (msg: string) => void;
}

export const ChatInputMessageContext = createContext<ChatInputMessageContextValue | null>(null);
