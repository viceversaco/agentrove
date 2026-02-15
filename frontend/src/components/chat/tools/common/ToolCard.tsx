import React, { JSX, memo, useState } from 'react';
import { Check, ChevronRight, Circle, X } from 'lucide-react';
import type { ToolEventStatus } from '@/types/tools.types';

const statusIndicator: Record<ToolEventStatus, JSX.Element> = {
  completed: <Check className="h-3 w-3 text-success-600 dark:text-success-400" />,
  failed: <X className="h-3 w-3 text-error-600 dark:text-error-400" />,
  started: (
    <Circle className="h-3 w-3 animate-pulse text-text-quaternary dark:text-text-dark-quaternary" />
  ),
};

type ToolCardTitle = string | ((status: ToolEventStatus) => string);

type Content = React.ReactNode | string | null | undefined;

interface ToolCardProps {
  icon: React.ReactNode;
  status: ToolEventStatus;
  title: ToolCardTitle;
  actions?: React.ReactNode;
  loadingContent?: Content;
  error?: Content;
  statusDetail?: Content;
  children?: React.ReactNode;
  className?: string;
  expandable?: boolean;
  defaultExpanded?: boolean;
}

const ToolCardInner: React.FC<ToolCardProps> = ({
  icon,
  status,
  title,
  actions,
  loadingContent,
  error,
  statusDetail,
  children,
  className = '',
  expandable = false,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const resolvedTitle = typeof title === 'function' ? title(status) : title;

  const hasExpandableContent = expandable && children;
  const showChildren = !expandable || expanded;

  const header = (
    <div className="flex items-center gap-1.5">
      <div className="flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary">
        {icon}
      </div>
      <span
        className="max-w-md truncate text-2xs text-text-tertiary dark:text-text-dark-tertiary"
        title={resolvedTitle}
      >
        {resolvedTitle}
      </span>
      {statusIndicator[status]}
      {hasExpandableContent && (
        <ChevronRight
          className={`h-3 w-3 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary ${expanded ? 'rotate-90' : ''}`}
        />
      )}
      {!expandable && actions}
    </div>
  );

  const meta = (
    <>
      {status === 'started' &&
        loadingContent &&
        (React.isValidElement(loadingContent) ? (
          loadingContent
        ) : (
          <p className="mt-0.5 pl-5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {loadingContent}
          </p>
        ))}
      {status === 'failed' &&
        error &&
        (React.isValidElement(error) ? (
          error
        ) : (
          <p className="mt-0.5 pl-5 text-2xs text-error-600 dark:text-error-500">{error}</p>
        ))}
      {statusDetail &&
        (React.isValidElement(statusDetail) ? (
          statusDetail
        ) : (
          <p className="mt-0.5 pl-5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {statusDetail}
          </p>
        ))}
    </>
  );

  return (
    <div className={`group/tool ${className}`}>
      {hasExpandableContent ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="-ml-1 rounded-md px-1 py-0.5 text-left transition-colors duration-150 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
        >
          {header}
        </button>
      ) : (
        <div className="-ml-1 px-1 py-0.5">{header}</div>
      )}
      {meta}
      {showChildren && children && (
        <div className="mt-1.5 border-l border-border pl-3 dark:border-border-dark">{children}</div>
      )}
    </div>
  );
};

export const ToolCard = memo(ToolCardInner);
