import { memo, useMemo, useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import { previewBackgroundClass } from './previewConstants';
import { getDisplayFileName, isValidBase64 } from './previewUtils';

export interface PDFPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PDFPreview = memo(function PDFPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: PDFPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);
  const fileName = getDisplayFileName(file, 'document.pdf');

  const blobUrl = useMemo(() => {
    if (!file.content || !isValidBase64(file.content)) return null;

    try {
      const bytes = base64ToUint8Array(file.content);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      return URL.createObjectURL(blob);
    } catch (error) {
      logger.error('PDF preview load failed', 'PDFPreview', error);
      return null;
    }
  }, [file.content]);

  useEffect(() => {
    if (blobUrl) {
      setPdfUrl(blobUrl);
      setError(false);
    } else {
      setError(true);
    }
    setIsLoading(false);

    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  if (isLoading) {
    return (
      <PreviewContainer
        fileName={fileName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <span className="text-text-tertiary dark:text-text-dark-tertiary">Loading PDF...</span>
      </PreviewContainer>
    );
  }

  if (error || !pdfUrl) {
    return (
      <PreviewContainer
        fileName={fileName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <span className="text-text-tertiary dark:text-text-dark-tertiary">Unable to load PDF</span>
      </PreviewContainer>
    );
  }

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName="overflow-hidden bg-surface dark:bg-surface-dark"
    >
      <iframe
        src={pdfUrl}
        className="h-full w-full border-0"
        title={fileName}
        onError={() => setError(true)}
      />
    </PreviewContainer>
  );
});
