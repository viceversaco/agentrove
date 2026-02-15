import { ArrowUp, LoaderCircle, Pause } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

export interface SendButtonProps {
  isLoading: boolean;
  isStreaming?: boolean;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
  type?: 'button' | 'submit';
  hasMessage?: boolean;
  className?: string;
  showLoadingSpinner?: boolean;
}

export function SendButton({
  isLoading,
  isStreaming = false,
  disabled,
  onClick,
  type = 'button',
  hasMessage = false,
  className = '',
  showLoadingSpinner = false,
}: SendButtonProps) {
  const baseClasses =
    'p-1.5 rounded-full transition-all duration-200 transform disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';

  const scaleClass = hasMessage && !disabled ? 'scale-100' : 'scale-90';

  const showSpinnerIcon = showLoadingSpinner && isLoading && !isStreaming;
  const showStopIcon = !showSpinnerIcon && (isLoading || isStreaming) && !hasMessage;

  let colorClasses;
  if (showSpinnerIcon) {
    colorClasses =
      'bg-text-primary dark:bg-text-dark-primary hover:bg-text-secondary dark:hover:bg-text-dark-secondary';
  } else if (showStopIcon) {
    colorClasses = 'bg-error-500 hover:bg-error-600';
  } else if (hasMessage) {
    colorClasses =
      'bg-text-primary dark:bg-text-dark-primary hover:bg-text-secondary dark:hover:bg-text-dark-secondary';
  } else {
    colorClasses = 'bg-surface-tertiary dark:bg-surface-dark-tertiary';
  }

  const cursorClass = !isLoading && !isStreaming && !hasMessage ? 'cursor-not-allowed' : '';

  const getAriaLabel = () => {
    if (showSpinnerIcon) return 'Starting chat';
    if (showStopIcon) return 'Stop generating';
    return 'Send message';
  };

  const renderIcon = () => {
    if (showSpinnerIcon) {
      return (
        <LoaderCircle className="h-4 w-4 animate-spin text-text-dark-primary dark:text-text-primary" />
      );
    }

    if (showStopIcon) {
      return <Pause className="h-3.5 w-3.5 animate-pulse text-text-dark-primary" />;
    }
    return (
      <ArrowUp
        className={`h-4 w-4 transition-transform ${hasMessage ? 'text-text-dark-primary dark:text-text-primary' : 'text-text-quaternary'}`}
      />
    );
  };

  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant="unstyled"
      className={`${baseClasses} ${scaleClass} ${colorClasses} ${cursorClass} ${className}`}
      aria-label={getAriaLabel()}
    >
      {renderIcon()}
    </Button>
  );
}
