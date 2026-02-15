import { memo, useMemo, type CSSProperties } from 'react';
import { logger } from '@/utils/logger';
import type { FileStructure } from '@/types/file-system.types';

const IMAGE_STYLE: CSSProperties = { imageRendering: 'auto' };
import { PreviewContainer } from './PreviewContainer';
import { previewBackgroundClass } from './previewConstants';
import { getDisplayFileName, isValidBase64 } from './previewUtils';

export interface ImagePreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const ImagePreview = memo(function ImagePreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: ImagePreviewProps) {
  const fileName = getDisplayFileName(file, 'image');
  const imageUrl = useMemo(() => {
    if (!file.content) return null;

    try {
      if (!isValidBase64(file.content)) {
        return null;
      }

      const lowercaseFileName = fileName.toLowerCase();
      let mimeType = 'image/jpeg';

      if (lowercaseFileName.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (lowercaseFileName.endsWith('.gif')) {
        mimeType = 'image/gif';
      } else if (lowercaseFileName.endsWith('.webp')) {
        mimeType = 'image/webp';
      } else if (lowercaseFileName.endsWith('.svg')) {
        mimeType = 'image/svg+xml';
      } else if (lowercaseFileName.endsWith('.bmp')) {
        mimeType = 'image/bmp';
      } else if (lowercaseFileName.endsWith('.ico')) {
        mimeType = 'image/x-icon';
      }

      return `data:${mimeType};base64,${file.content}`;
    } catch (error) {
      logger.error('Image preview load failed', 'ImagePreview', error);
      return null;
    }
  }, [file.content, fileName]);

  if (!imageUrl) {
    return (
      <PreviewContainer
        fileName={fileName}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
        contentClassName={`flex items-center justify-center ${previewBackgroundClass}`}
      >
        <p className="text-text-tertiary dark:text-text-dark-tertiary">Unable to load image</p>
      </PreviewContainer>
    );
  }

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName="min-h-0 overflow-auto p-4 flex items-center justify-center"
    >
      <img
        src={imageUrl}
        alt={fileName}
        className="max-h-full max-w-full object-contain"
        style={IMAGE_STYLE}
      />
    </PreviewContainer>
  );
});
