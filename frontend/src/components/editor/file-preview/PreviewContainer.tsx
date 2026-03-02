import { memo, ReactNode } from 'react';
import { PreviewHeader, PreviewHeaderProps } from './PreviewHeader';
import { previewBackgroundClass } from './previewConstants';

interface PreviewContainerProps extends PreviewHeaderProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  disableContentWrapper?: boolean;
}

export const PreviewContainer = memo(function PreviewContainer({
  fileName,
  isFullscreen,
  onToggleFullscreen,
  children,
  className = '',
  contentClassName = '',
  disableContentWrapper = false,
}: PreviewContainerProps) {
  return (
    <div className={`flex flex-col ${previewBackgroundClass} h-full ${className}`}>
      {isFullscreen && (
        <PreviewHeader
          fileName={fileName}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}

      {disableContentWrapper ? (
        children
      ) : (
        <div className={`min-h-0 flex-1 ${contentClassName}`}>{children}</div>
      )}
    </div>
  );
});
