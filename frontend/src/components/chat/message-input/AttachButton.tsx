import { Image } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

export interface AttachButtonProps {
  onAttach?: () => void;
}

export function AttachButton({ onAttach }: AttachButtonProps) {
  return (
    <Button
      type="button"
      onClick={onAttach}
      variant="unstyled"
      className="rounded-full p-1.5 text-text-tertiary transition-all duration-200 hover:bg-surface-hover hover:text-text-primary active:scale-95 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      aria-label="Attach file"
    >
      <Image className="h-4 w-4" />
    </Button>
  );
}
