import { useState, useEffect, useCallback } from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Select } from '@/components/ui/primitives/Select';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { usePreviewLinksQuery } from '@/hooks/queries/useSandboxQueries';
import { NoOpenPortsState } from '../shared/NoOpenPortsState';
import { cn } from '@/utils/cn';

export interface MobilePreviewProps {
  sandboxId?: string;
}

export const MobilePreview = ({ sandboxId }: MobilePreviewProps) => {
  const [qrCode, setQrCode] = useState('');
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [selectedPortId, setSelectedPortId] = useState<number | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const {
    data: ports = [],
    isLoading: loadingPorts,
    refetch,
  } = usePreviewLinksQuery(sandboxId || '', {
    enabled: !!sandboxId,
  });

  const selectedPort =
    ports.length > 0 ? ports.find((p) => p.port === selectedPortId) || ports[0] : null;

  const previewUrl = selectedPort?.previewUrl || '';
  const expoUrl = previewUrl.replace(/^https?:\/\//, 'exp://');

  useEffect(() => {
    if (!previewUrl) return;

    setIsLoadingQr(true);
    (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const dataUrl = await QRCode.toDataURL(expoUrl, {
          width: 280,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });
        setQrCode(dataUrl);
      } catch {
        setQrCode('');
      } finally {
        setIsLoadingQr(false);
      }
    })();
  }, [previewUrl, expoUrl]);

  const handleRefresh = useCallback(() => {
    setIframeKey((prev) => prev + 1);
    refetch();
  }, [refetch]);

  if (!sandboxId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="flex flex-col items-center gap-2">
          <Smartphone className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
          <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
            No sandbox connected
          </p>
        </div>
      </div>
    );
  }

  if (ports.length === 0) {
    return <NoOpenPortsState onRefresh={handleRefresh} loading={loadingPorts} />;
  }

  return (
    <div className="flex h-full bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className="relative flex flex-1 items-center justify-center p-8">
        {ports.length > 0 && (
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              Port
            </span>
            <Select
              value={selectedPort?.port?.toString() ?? ''}
              onChange={(e) => setSelectedPortId(Number(e.target.value))}
              className="h-6 border-border/30 bg-transparent text-2xs dark:border-border-dark/30"
            >
              {ports.map((p) => (
                <option key={p.port} value={p.port}>
                  {p.port}
                </option>
              ))}
            </Select>
            <Button
              onClick={handleRefresh}
              disabled={loadingPorts}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:hover:text-text-dark-secondary"
              title="Refresh"
            >
              <RefreshCw className={cn('h-3 w-3', loadingPorts && 'animate-spin')} />
            </Button>
          </div>
        )}

        <div className="relative">
          <div className="relative h-[700px] w-[340px] rounded-5xl border-[14px] border-surface-tertiary bg-surface-tertiary shadow-strong dark:border-surface-dark-tertiary dark:bg-surface-dark-tertiary">
            <div className="absolute left-1/2 top-0 z-10 h-8 w-32 -translate-x-1/2 rounded-b-3xl bg-surface dark:bg-surface-dark" />

            <div className="relative h-full w-full overflow-hidden rounded-4xl bg-white dark:bg-surface-dark-secondary">
              <iframe
                key={`${previewUrl}-${iframeKey}`}
                src={previewUrl}
                className="h-full w-full border-0"
                title="App Preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-[380px] items-center justify-center border-l border-border/50 p-8 dark:border-border-dark/50">
        <div className="w-full max-w-xs">
          <h3 className="mb-6 text-center text-sm font-medium text-text-primary dark:text-text-dark-primary">
            Test on your phone
          </h3>

          <div className="mb-6 flex justify-center">
            <div className="inline-block rounded-xl bg-surface-tertiary/50 p-4 dark:bg-surface-dark-tertiary/50">
              {isLoadingQr ? (
                <div className="flex h-64 w-64 items-center justify-center">
                  <Spinner
                    size="md"
                    className="text-text-quaternary dark:text-text-dark-quaternary"
                  />
                </div>
              ) : qrCode ? (
                <img src={qrCode} alt="Expo QR Code" className="h-64 w-64" />
              ) : (
                <div className="flex h-64 w-64 items-center justify-center">
                  <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                    QR code unavailable
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-center text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
              Scan QR code to open
            </p>
            <ol className="list-inside list-decimal space-y-1.5 pl-1 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
              <li>Install Expo Go from App Store or Play Store</li>
              <li>Open Camera app</li>
              <li>Scan the QR code above</li>
            </ol>

            <div className="border-t border-border/30 pt-3 dark:border-border-dark/30">
              <p className="mb-1.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                Or enter this URL manually:
              </p>
              <div className="break-all rounded-lg bg-surface-tertiary/50 p-2.5 font-mono text-2xs text-text-tertiary dark:bg-surface-dark-tertiary/50 dark:text-text-dark-tertiary">
                {expoUrl}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
