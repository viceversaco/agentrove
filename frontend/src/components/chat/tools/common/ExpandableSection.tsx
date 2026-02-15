import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';

interface ExpandableSectionProps {
  label: React.ReactNode;
  children: React.ReactNode;
  meta?: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  buttonClassName?: string;
  contentWrapperClassName?: string;
  bodyClassName?: string;
}

const baseButtonClass = `flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-secondary dark:text-text-dark-secondary
  hover:text-text-primary dark:hover:text-text-dark-primary transition-colors
  bg-surface-tertiary/50 dark:bg-surface-dark-tertiary/30 rounded-md w-full text-left
  hover:bg-surface-hover dark:hover:bg-surface-dark-hover`;

const baseContentClass = `mt-1 rounded-md border border-border/50 dark:border-border-dark/50
  bg-surface-tertiary/30 dark:bg-surface-dark-tertiary/20 overflow-hidden`;

export const ExpandableSection: React.FC<ExpandableSectionProps> = ({
  label,
  children,
  meta,
  defaultExpanded = false,
  className = '',
  buttonClassName = '',
  contentWrapperClassName = '',
  bodyClassName = '',
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`px-3 pb-2 ${className}`}>
      <Button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        variant="unstyled"
        className={`${baseButtonClass} ${buttonClassName}`}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        <span>{label}</span>
        {meta ? <span className="ml-auto flex items-center gap-1.5 text-2xs">{meta}</span> : null}
      </Button>

      {expanded && (
        <div className={`${baseContentClass} ${contentWrapperClassName}`}>
          <div className={bodyClassName}>{children}</div>
        </div>
      )}
    </div>
  );
};
