import { TerminalPanel } from '../sandbox/terminal/TerminalPanel';
import type { Chat } from '@/types/chat.types';

interface TerminalViewProps {
  currentChat?: Chat | null;
  isVisible: boolean;
  panelKey: 'single' | 'primary' | 'secondary';
}

export function TerminalView({ currentChat, isVisible, panelKey }: TerminalViewProps) {
  return (
    <div className="h-full w-full">
      <TerminalPanel currentChat={currentChat} isVisible={isVisible} panelKey={panelKey} />
    </div>
  );
}
