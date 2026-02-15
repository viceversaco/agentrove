import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Terminal as XTerm, ITerminalInitOnlyOptions, ITerminalOptions } from 'xterm';
import type { FitAddon as FitAddonType } from 'xterm-addon-fit';

import { buildTerminalTheme, createTerminalOptions } from '@/utils/terminal';
import type { TerminalSize } from '@/types/sandbox.types';

interface UseXtermOptions {
  disableStdin?: boolean;
  isVisible: boolean;
  mode: 'light' | 'dark';
  onData?: (data: string) => void;
  onFit?: (size: TerminalSize) => void;
}

interface UseXtermReturn {
  fitTerminal: () => TerminalSize | null;
  isReady: boolean;
  terminalRef: MutableRefObject<XTerm | null>;
  wrapperRef: MutableRefObject<HTMLDivElement | null>;
}

export const useXterm = ({
  disableStdin = false,
  isVisible,
  mode,
  onData,
  onFit,
}: UseXtermOptions): UseXtermReturn => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddonType | null>(null);
  const inputHandlerRef = useRef<ReturnType<XTerm['onData']> | null>(null);
  const [isReady, setIsReady] = useState(false);

  const initialModeRef = useRef(mode);
  // Prevents re-initialization after cleanup; terminal should only init once per mount
  const hasInitializedRef = useRef(false);
  // Lazy initialization: only create terminal when visible OR already initialized
  const shouldInitialize = hasInitializedRef.current || isVisible;

  // Fits terminal to container size. Accesses internal xterm.js APIs to check
  // if the renderer is ready - FitAddon crashes if called before initialization.
  // This internal API access is necessary because xterm.js doesn't expose
  // a public "ready" state for the renderer.
  const fitTerminal = useCallback((): TerminalSize | null => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;

    if (!fitAddon || !terminal) {
      return null;
    }

    // Check internal renderer state to avoid FitAddon errors.
    // FitAddon.fit() throws if called before renderer is initialized.
    const terminalCore = (
      terminal as unknown as {
        _core?: {
          _renderService?: {
            _renderer?: { value?: unknown };
          };
        };
      }
    )._core;
    const renderService = terminalCore?._renderService;
    const renderer = renderService?._renderer?.value;

    if (!renderer) {
      return null;
    }

    try {
      fitAddon.fit();
    } catch (error) {
      if (error instanceof TypeError && `${error.message}`.includes('dimensions')) {
        return null;
      }
      throw error;
    }

    const size = {
      rows: terminal.rows,
      cols: terminal.cols,
    };

    if (onFit) {
      onFit(size);
    }

    return size;
  }, [onFit]);

  useEffect(() => {
    if (!shouldInitialize) {
      return undefined;
    }

    const container = wrapperRef.current;
    if (!container || terminalRef.current) {
      return undefined;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return undefined;
    }

    let cancelled = false;
    let openFrameId: number | null = null;
    let xterm: XTerm | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
      ]);

      if (cancelled) return;

      const theme = buildTerminalTheme(initialModeRef.current);
      const baseOptions = createTerminalOptions(theme);

      xterm = new Terminal({
        ...baseOptions,
        disableStdin,
      });
      const fitAddon = new FitAddon();

      hasInitializedRef.current = true;
      fitAddonRef.current = fitAddon;
      terminalRef.current = xterm;

      xterm.loadAddon(fitAddon);

      const currentXterm = xterm;
      openFrameId = requestAnimationFrame(() => {
        openFrameId = null;
        if (cancelled || !container.isConnected || terminalRef.current !== currentXterm) {
          return;
        }
        try {
          currentXterm.open(container);
          setIsReady(true);
        } catch {
          terminalRef.current = null;
          hasInitializedRef.current = false;
        }
      });
    })();

    return () => {
      cancelled = true;
      if (openFrameId !== null) {
        cancelAnimationFrame(openFrameId);
      }
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
      fitAddonRef.current = null;
      terminalRef.current = null;
      try {
        xterm?.dispose();
      } catch {
        // Ignore dispose errors
      }
      setIsReady(false);
      hasInitializedRef.current = false;
    };
  }, [disableStdin, shouldInitialize]);

  useEffect(() => {
    const terminal = terminalRef.current;

    if (!terminal || !onData || disableStdin) {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
      return;
    }

    inputHandlerRef.current?.dispose();
    inputHandlerRef.current = terminal.onData(onData);

    return () => {
      inputHandlerRef.current?.dispose();
      inputHandlerRef.current = null;
    };
  }, [onData, disableStdin]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    const terminalCore = (
      terminal as unknown as {
        _core?: {
          _renderService?: {
            _renderer?: { value?: unknown };
          };
        };
      }
    )._core;
    const renderer = terminalCore?._renderService?._renderer?.value;
    if (!renderer) {
      return;
    }

    const { cols, rows, ...mutableOptions } = terminal.options as ITerminalOptions &
      ITerminalInitOnlyOptions;
    void cols;
    void rows;

    try {
      terminal.options = {
        ...(mutableOptions as ITerminalOptions),
        disableStdin,
        theme: buildTerminalTheme(mode),
      };
    } catch {
      return;
    }

    if (isReady && isVisible) {
      const frame = requestAnimationFrame(() => {
        fitTerminal();
      });
      return () => cancelAnimationFrame(frame);
    }

    return undefined;
  }, [mode, disableStdin, isReady, isVisible, fitTerminal]);

  useEffect(() => {
    if (!isReady || !isVisible) {
      return undefined;
    }

    let frame: number | null = null;
    let timeoutShort: number | null = null;
    let timeoutLong: number | null = null;
    let cancelled = false;

    const scheduleFit = (delayMs?: number) => {
      if (delayMs === undefined) {
        frame = requestAnimationFrame(() => {
          if (!cancelled) {
            fitTerminal();
          }
        });
        return;
      }

      const timeoutId = window.setTimeout(() => {
        if (!cancelled) {
          fitTerminal();
        }
      }, delayMs);

      if (delayMs <= 50) {
        timeoutShort = timeoutId;
      } else {
        timeoutLong = timeoutId;
      }
    };

    scheduleFit();
    scheduleFit(50);
    scheduleFit(250);

    const fonts = document.fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => {
        if (!cancelled) {
          fitTerminal();
        }
      });
    }

    return () => {
      cancelled = true;
      if (frame) {
        cancelAnimationFrame(frame);
      }
      if (timeoutShort) {
        clearTimeout(timeoutShort);
      }
      if (timeoutLong) {
        clearTimeout(timeoutLong);
      }
    };
  }, [isReady, isVisible, fitTerminal]);

  // Handles container resize events with requestAnimationFrame debouncing.
  // Only fits when visible to avoid unnecessary work for hidden terminals.
  useEffect(() => {
    const container = wrapperRef.current;
    if (!container || !isReady) {
      return undefined;
    }

    let frame: number | null = null;

    // Debounce resize events to avoid excessive fit() calls during drag resize
    const resizeObserver = new ResizeObserver(() => {
      if (!isVisible) {
        return;
      }
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        fitTerminal();
      });
    });

    resizeObserver.observe(container);

    // Initial fit when terminal becomes visible
    if (isVisible) {
      frame = requestAnimationFrame(() => {
        fitTerminal();
      });
    }

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
    };
  }, [isReady, isVisible, fitTerminal]);

  return useMemo(
    () => ({
      fitTerminal,
      isReady,
      terminalRef,
      wrapperRef,
    }),
    [fitTerminal, isReady],
  );
};
