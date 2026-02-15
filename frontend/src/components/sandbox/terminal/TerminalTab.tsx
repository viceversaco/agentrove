import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { logger } from '@/utils/logger';
import type { FC } from 'react';
import 'xterm/css/xterm.css';

import { useUIStore } from '@/store/uiStore';
import { authService } from '@/services/authService';
import { WS_BASE_URL } from '@/lib/api';

import { getTerminalBackgroundClass } from '@/utils/terminal';
import { useXterm } from '@/hooks/useXterm';
import type { TerminalSize } from '@/types/sandbox.types';

export interface TerminalTabProps {
  isVisible: boolean;
  sandboxId?: string;
  terminalId?: string;
  shouldClose?: boolean;
  onClosed?: () => void;
}

type SessionState = 'idle' | 'connecting' | 'ready' | 'error';

const encoder = new TextEncoder();

export const TerminalTab: FC<TerminalTabProps> = ({
  isVisible,
  sandboxId,
  terminalId,
  shouldClose = false,
  onClosed,
}) => {
  const theme = useUIStore((state) => state.theme);
  const [sessionState, setSessionState] = useState<SessionState>('idle');

  const lastSentSizeRef = useRef<TerminalSize | null>(null);
  const hasSentInitRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const isClosingRef = useRef(false);
  const shouldCloseRef = useRef(false);

  const backgroundClass = useMemo(() => getTerminalBackgroundClass(theme), [theme]);

  const handleFit = useCallback((size: TerminalSize) => {
    if (!hasSentInitRef.current) {
      return;
    }

    const ws = wsRef.current;
    const lastSent = lastSentSizeRef.current;

    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      (lastSent && lastSent.rows === size.rows && lastSent.cols === size.cols)
    ) {
      return;
    }

    ws.send(JSON.stringify({ type: 'resize', rows: size.rows, cols: size.cols }));
    lastSentSizeRef.current = size;
  }, []);

  const { fitTerminal, isReady, terminalRef, wrapperRef } = useXterm({
    isVisible,
    mode: theme,
    onData: (data: string) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    },
    onFit: handleFit,
  });

  useEffect(() => {
    shouldCloseRef.current = shouldClose;
  }, [shouldClose]);

  useEffect(() => {
    if (!sandboxId || !isReady) return;

    const token = authService.getToken();
    if (!token) return;

    const terminalParam = terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : '';
    const wsUrl = `${WS_BASE_URL}/${sandboxId}/terminal${terminalParam}`;

    setSessionState('connecting');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    hasSentInitRef.current = false;
    lastSentSizeRef.current = null;

    const handleOpen = () => {
      setSessionState('connecting');

      ws.send(JSON.stringify({ type: 'auth', token }));

      const size =
        fitTerminal() ??
        (terminalRef.current
          ? { rows: terminalRef.current.rows, cols: terminalRef.current.cols }
          : { rows: 24, cols: 80 });

      const payload = {
        type: 'init',
        rows: size.rows,
        cols: size.cols,
      };

      ws.send(JSON.stringify(payload));
      hasSentInitRef.current = true;
      lastSentSizeRef.current = size;

      requestAnimationFrame(() => {
        terminalRef.current?.focus();
      });
    };

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        return;
      }
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (message.type === 'stdout' && typeof message.data === 'string') {
          terminalRef.current?.write(message.data);
          setSessionState((prev) => (prev === 'connecting' ? 'ready' : prev));
          return;
        }
        if (message.type === 'init') {
          const rows = typeof message.rows === 'number' ? message.rows : undefined;
          const cols = typeof message.cols === 'number' ? message.cols : undefined;
          if (rows && cols) {
            lastSentSizeRef.current = { rows, cols };
          }
          setSessionState('ready');
          return;
        }
        if (message.type === 'error') {
          setSessionState('error');
        }
      } catch (error) {
        logger.error('Terminal write failed', 'TerminalTab', error);
      }
    };

    const handleError = () => {
      setSessionState('error');
    };

    const handleClose = () => {
      wsRef.current = null;
      hasSentInitRef.current = false;
      lastSentSizeRef.current = null;
      setSessionState((prev) => (prev === 'error' ? prev : 'idle'));
    };

    const handleBeforeUnload = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'detach' }));
      }
      ws.close();
    };

    ws.addEventListener('open', handleOpen);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('error', handleError);
    ws.addEventListener('close', handleClose);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('message', handleMessage);
      ws.removeEventListener('error', handleError);
      ws.removeEventListener('close', handleClose);

      if (!shouldCloseRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'detach' }));
      }
      ws.close();
      wsRef.current = null;
      hasSentInitRef.current = false;
      lastSentSizeRef.current = null;
      setSessionState('idle');
    };
  }, [sandboxId, terminalId, isReady, fitTerminal, terminalRef]);

  useEffect(() => {
    if (!shouldClose || isClosingRef.current) {
      return;
    }

    isClosingRef.current = true;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'close' }));
    }
    ws?.close();
    wsRef.current = null;
    hasSentInitRef.current = false;
    lastSentSizeRef.current = null;
    setSessionState('idle');
    onClosed?.();
  }, [shouldClose, onClosed]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }, [isVisible, terminalRef]);

  const overlayMessage = useMemo(() => {
    if (!isReady) {
      return 'Initializing terminal...';
    }

    switch (sessionState) {
      case 'connecting':
        return 'Connecting to sandbox terminal...';
      case 'error':
        return 'Terminal connection interrupted';
      default:
        return null;
    }
  }, [isReady, sessionState]);

  const shouldShowOverlay = isVisible && overlayMessage !== null;

  return (
    <div className={`relative flex h-full flex-col ${backgroundClass}`}>
      <div className="h-full overflow-hidden p-2">
        <div ref={wrapperRef} className={`h-full w-full ${isVisible ? 'block' : 'hidden'}`} />
      </div>
      {shouldShowOverlay && (
        <div className={`absolute inset-0 flex items-center justify-center ${backgroundClass}`}>
          <div className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
            {overlayMessage}
          </div>
        </div>
      )}
    </div>
  );
};
