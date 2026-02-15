import { memo, useState, useCallback, lazy, Suspense } from 'react';
import { Globe, RotateCcw, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import {
  useVNCUrlQuery,
  useBrowserStatusQuery,
  useStartBrowserMutation,
  useStopBrowserMutation,
} from '@/hooks/queries/useSandboxQueries';
import { cn } from '@/utils/cn';

const VNCClient = lazy(() =>
  import('@/components/sandbox/vnc-browser/VNCClient').then((m) => ({ default: m.VNCClient })),
);

const DEFAULT_BROWSER_URL = 'https://www.google.com';

interface BrowserViewProps {
  sandboxId?: string;
  isActive?: boolean;
}

export const BrowserView = memo(function BrowserView({
  sandboxId,
  isActive = false,
}: BrowserViewProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [vncInstanceKey, setVncInstanceKey] = useState(0);
  const [browserUrl, setBrowserUrl] = useState(DEFAULT_BROWSER_URL);

  const {
    data: vncUrl,
    refetch: refetchVncUrl,
    isFetching: isFetchingUrl,
  } = useVNCUrlQuery(sandboxId || '', { enabled: !!sandboxId && isActive });

  const { data: browserStatus } = useBrowserStatusQuery(sandboxId || '', {
    enabled: !!sandboxId && isActive,
  });

  const startBrowserMutation = useStartBrowserMutation();
  const stopBrowserMutation = useStopBrowserMutation();

  const handleStartBrowser = useCallback(() => {
    if (sandboxId) {
      setIsConnecting(true);
      startBrowserMutation.mutate(
        {
          sandboxId,
          url: browserUrl,
        },
        {
          onSuccess: () => {
            setTimeout(() => refetchVncUrl(), 2000);
          },
          onError: () => {
            setIsConnecting(false);
          },
        },
      );
    }
  }, [sandboxId, startBrowserMutation, refetchVncUrl, browserUrl]);

  const handleStopBrowser = useCallback(() => {
    if (sandboxId) {
      stopBrowserMutation.mutate({ sandboxId });
    }
  }, [sandboxId, stopBrowserMutation]);

  const handleConnect = useCallback(() => {
    setIsConnecting(false);
    setConnectionError(null);
  }, []);

  const handleDisconnect = useCallback(() => {
    setIsConnecting(false);
  }, []);

  const handleError = useCallback((error: string) => {
    setConnectionError(error);
    setIsConnecting(false);
  }, []);

  const handleReconnect = useCallback(() => {
    setIsConnecting(true);
    setConnectionError(null);
    setVncInstanceKey((prev) => prev + 1);
    refetchVncUrl();
  }, [refetchVncUrl]);

  const isBrowserRunning = browserStatus?.running;

  if (!sandboxId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary text-xs text-text-quaternary dark:bg-surface-dark-secondary dark:text-text-dark-quaternary">
        No sandbox connected
      </div>
    );
  }

  if (!isActive) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex h-9 items-center border-b border-border/50 px-3 dark:border-border-dark/50">
        <div className="flex flex-1 items-center gap-2">
          <Button
            onClick={handleReconnect}
            variant="unstyled"
            className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            title="Reconnect"
          >
            <RotateCcw className={cn('h-3 w-3', isFetchingUrl && 'animate-spin')} />
          </Button>

          <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
            Browser
          </span>

          <div className="flex-1" />

          {isBrowserRunning && (
            <Button
              onClick={handleStopBrowser}
              variant="unstyled"
              disabled={stopBrowserMutation.isPending}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-error-600 disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-error-400"
              title="Stop browser"
            >
              <Square className="h-2.5 w-2.5" />
              Stop
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {isConnecting && isBrowserRunning && !connectionError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-secondary/80 dark:bg-surface-dark-secondary/80">
            <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
            <span className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
              Connecting...
            </span>
          </div>
        )}

        {connectionError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface-secondary/80 dark:bg-surface-dark-secondary/80">
            <span className="text-xs text-error-500 dark:text-error-400">{connectionError}</span>
            <Button
              onClick={handleReconnect}
              variant="unstyled"
              className="rounded-md px-3 py-1 text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            >
              Retry
            </Button>
          </div>
        )}

        {!isBrowserRunning && !isConnecting && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-surface-secondary dark:bg-surface-dark-secondary">
            <Globe className="h-6 w-6 text-text-quaternary dark:text-text-dark-quaternary" />
            <div className="flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
                Start a browser session
              </span>
              <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Enter a URL to browse
              </span>
            </div>
            <input
              type="text"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-72 rounded-lg border border-border/50 bg-transparent px-3 py-1.5 font-mono text-xs text-text-primary outline-none transition-colors duration-200 focus:border-border-hover dark:border-border-dark/50 dark:text-text-dark-primary dark:focus:border-border-dark-hover"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !startBrowserMutation.isPending) {
                  handleStartBrowser();
                }
              }}
            />
            <Button
              onClick={handleStartBrowser}
              variant="unstyled"
              disabled={startBrowserMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            >
              <Play className="h-3.5 w-3.5" />
              Start Browser
            </Button>
          </div>
        )}

        {vncUrl && isBrowserRunning && (
          <Suspense
            fallback={
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-secondary/70 dark:bg-surface-dark-secondary/70">
                <Spinner
                  size="md"
                  className="text-text-quaternary dark:text-text-dark-quaternary"
                />
              </div>
            }
          >
            <VNCClient
              wsUrl={vncUrl}
              isActive={isActive}
              instanceKey={vncInstanceKey}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onError={handleError}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});
