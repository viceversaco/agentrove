import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

interface NoOpenPortsStateProps {
  onRefresh: () => void;
  loading?: boolean;
}

export const NoOpenPortsState = ({ onRefresh, loading = false }: NoOpenPortsStateProps) => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-secondary dark:bg-surface-dark-secondary">
      <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
        No open ports detected
      </p>
      <Button
        onClick={onRefresh}
        disabled={loading}
        variant="unstyled"
        className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-secondary"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </Button>
    </div>
  );
};
