import { memo, useState, useCallback, useMemo, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Smartphone, Monitor, ExternalLink, RotateCcw } from 'lucide-react';
import type { PortInfo } from '@/types/sandbox.types';
import { Button } from '@/components/ui/primitives/Button';
import { Select } from '@/components/ui/primitives/Select';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { cn } from '@/utils/cn';

interface DeviceButtonProps {
  active: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}

const DeviceButton = ({ active, onClick, title, children }: DeviceButtonProps) => (
  <Button
    onClick={onClick}
    variant="unstyled"
    className={cn(
      'rounded-md p-1 transition-colors duration-200',
      active
        ? 'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
        : 'text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
    )}
    title={title}
  >
    {children}
  </Button>
);

export interface PanelProps {
  previewUrl?: string;
  ports?: PortInfo[];
  selectedPort?: PortInfo | null;
  onPortChange?: (port: PortInfo) => void;
  onRefreshPorts?: () => void;
}

export const Panel = memo(function Panel({
  previewUrl,
  ports = [],
  selectedPort,
  onPortChange,
  onRefreshPorts,
}: PanelProps) {
  const [deviceView, setDeviceView] = useState<'desktop' | 'mobile'>('desktop');
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(previewUrl));
  const [reloadToken, setReloadToken] = useState(0);

  const iframeKey = useMemo(() => {
    if (!previewUrl) return 'no-preview';
    return `${previewUrl}-${reloadToken}`;
  }, [previewUrl, reloadToken]);

  const handlePreviewLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handlePreviewError = useCallback(() => {
    setIsLoading(false);
  }, []);

  const handleOpenInNewTab = useCallback(() => {
    if (previewUrl) {
      window.open(previewUrl, '_blank');
    }
  }, [previewUrl]);

  const handleReload = useCallback(() => {
    if (!previewUrl) return;
    setIsLoading(true);
    setReloadToken((token) => token + 1);
    onRefreshPorts?.();
  }, [previewUrl, onRefreshPorts]);

  useEffect(() => {
    if (previewUrl) {
      setIsLoading(true);
    } else {
      setIsLoading(false);
    }
  }, [previewUrl]);

  if (!previewUrl) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
        <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
          No preview available
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="flex h-9 items-center border-b border-border/50 px-3 dark:border-border-dark/50">
        <div className="flex flex-1 items-center gap-2">
          <Button
            onClick={handleReload}
            variant="unstyled"
            className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            title="Reload preview"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>

          <p
            className="flex-1 truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary"
            title={previewUrl}
          >
            {previewUrl}
          </p>

          <Button
            onClick={handleOpenInNewTab}
            variant="unstyled"
            className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            title="Open in new tab"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>

          <div className="flex items-center gap-0.5 rounded-lg bg-surface-tertiary/50 p-0.5 dark:bg-surface-dark-tertiary/50">
            <DeviceButton
              active={deviceView === 'desktop'}
              onClick={() => setDeviceView('desktop')}
              title="Desktop view"
            >
              <Monitor className="h-3 w-3" />
            </DeviceButton>
            <DeviceButton
              active={deviceView === 'mobile'}
              onClick={() => setDeviceView('mobile')}
              title="Mobile view"
            >
              <Smartphone className="h-3 w-3" />
            </DeviceButton>
          </div>
        </div>

        {ports.length > 0 && (
          <div className="ml-2 flex items-center gap-1.5 border-l border-border/30 pl-2 dark:border-border-dark/30">
            <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Port
            </span>
            <Select
              value={selectedPort?.port?.toString() ?? ''}
              onChange={(e) => {
                const port = ports.find((p) => p.port === Number(e.target.value));
                if (port && onPortChange) onPortChange(port);
              }}
              className="h-6 border-border/30 bg-transparent text-2xs dark:border-border-dark/30"
            >
              {ports.map((port) => (
                <option key={port.port} value={port.port}>
                  {port.port}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div className="relative h-full w-full flex-1 overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-secondary/80 dark:bg-surface-dark-secondary/80">
            <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
          </div>
        )}
        <div
          className={cn(
            'h-full w-full transition-all duration-300',
            deviceView === 'mobile' &&
              'mx-auto max-w-sm border-x border-border/30 dark:border-border-dark/30',
          )}
        >
          <iframe
            key={iframeKey}
            src={previewUrl}
            className="h-full w-full border-0 bg-white"
            title="Code Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={handlePreviewLoad}
            onError={handlePreviewError}
          />
        </div>
      </div>
    </div>
  );
});
