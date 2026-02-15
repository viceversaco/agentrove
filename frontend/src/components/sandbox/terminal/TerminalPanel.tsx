import { Container } from './Container';
import type { Chat } from '@/types/chat.types';

interface TerminalPanelProps {
  currentChat?: Chat | null;
  isVisible: boolean;
  panelKey: 'single' | 'primary' | 'secondary';
}

export function TerminalPanel({ currentChat, isVisible, panelKey }: TerminalPanelProps) {
  return (
    <Container
      sandboxId={currentChat?.sandbox_id}
      chatId={currentChat?.id}
      isVisible={isVisible}
      panelKey={panelKey}
    />
  );
}
