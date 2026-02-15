import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

interface CollapsibleButtonProps {
  label: string;
  labelWhenExpanded?: string;
  isExpanded: boolean;
  onToggle: () => void;
  count?: number;
  fullWidth?: boolean;
}

export const CollapsibleButton: React.FC<CollapsibleButtonProps> = ({
  label,
  labelWhenExpanded,
  isExpanded,
  onToggle,
  count,
  fullWidth = false,
}) => {
  const effectiveLabel = isExpanded && labelWhenExpanded ? labelWhenExpanded : label;
  const displayLabel = count !== undefined ? `${effectiveLabel} (${count})` : effectiveLabel;

  return (
    <Button
      type="button"
      onClick={onToggle}
      variant="unstyled"
      className={`flex items-center ${fullWidth ? 'w-full justify-between gap-2' : 'gap-1'} group/button rounded-lg bg-surface-tertiary/50 px-3 py-1.5 text-xs font-medium text-text-secondary transition-all duration-200 hover:bg-surface-hover dark:bg-surface-dark-tertiary/30 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover`}
    >
      <span>{displayLabel}</span>
      <ChevronDown
        className={`h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/button:text-text-primary dark:group-hover/button:text-text-dark-primary ${isExpanded ? 'rotate-180' : ''}`}
      />
    </Button>
  );
};
