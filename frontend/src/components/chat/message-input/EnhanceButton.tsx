import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

export interface EnhanceButtonProps {
  onEnhance?: () => void;
  isEnhancing?: boolean;
  disabled?: boolean;
}

export function EnhanceButton({
  onEnhance,
  isEnhancing = false,
  disabled = false,
}: EnhanceButtonProps) {
  return (
    <Button
      type="button"
      onClick={onEnhance}
      disabled={disabled || isEnhancing}
      variant="unstyled"
      className={`group rounded-full p-1.5 transition-all duration-200 ${
        disabled || isEnhancing
          ? 'cursor-not-allowed text-text-tertiary opacity-50 dark:text-text-dark-tertiary'
          : 'bg-transparent text-text-tertiary hover:bg-surface-hover hover:text-text-secondary active:scale-95 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
      }`}
      aria-label={isEnhancing ? 'Enhancing prompt...' : 'Enhance prompt'}
      title={isEnhancing ? 'Enhancing prompt...' : 'Enhance prompt with AI'}
    >
      <Sparkles className={`h-3.5 w-3.5 ${isEnhancing ? 'animate-spin' : ''}`} />
    </Button>
  );
}
