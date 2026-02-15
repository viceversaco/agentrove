import { memo, ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';

interface SelectItemProps {
  isSelected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}

function SelectItemInner({ isSelected, onSelect, className, children }: SelectItemProps) {
  return (
    <Button
      onClick={onSelect}
      variant="unstyled"
      className={cn(
        'w-full rounded-lg px-2 py-1.5 text-left transition-all duration-150',
        isSelected
          ? 'bg-surface-hover/80 dark:bg-surface-dark-hover/80'
          : 'hover:bg-surface-hover/50 active:bg-surface-hover/70 dark:hover:bg-surface-dark-hover/50 dark:active:bg-surface-dark-hover/70',
        className,
      )}
    >
      {children}
    </Button>
  );
}

export const SelectItem = memo(SelectItemInner);
