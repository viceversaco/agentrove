import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { SearchInput } from './SearchInput';

export interface HeaderProps {
  onDownload?: () => void;
  isDownloading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onSearchClear?: () => void;
  onClose?: () => void;
}

export function Header({
  onDownload,
  isDownloading = false,
  onRefresh,
  isRefreshing = false,
  searchQuery = '',
  onSearchChange,
  onSearchClear,
  onClose,
}: HeaderProps) {
  return (
    <div className="flex flex-none flex-col gap-2 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
          Files
        </span>

        <div className="flex items-center gap-0.5">
          {onRefresh && (
            <Button
              onClick={onRefresh}
              disabled={isRefreshing}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary disabled:cursor-wait disabled:opacity-50 dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              title="Refresh"
            >
              {isRefreshing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
            </Button>
          )}

          {onDownload && (
            <Button
              onClick={onDownload}
              disabled={isDownloading}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary disabled:cursor-wait disabled:opacity-50 dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              title="Download"
            >
              {isDownloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          )}

          {onClose && (
            <Button
              onClick={onClose}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {onSearchChange && onSearchClear && (
        <SearchInput value={searchQuery} onChange={onSearchChange} onClear={onSearchClear} />
      )}
    </div>
  );
}
