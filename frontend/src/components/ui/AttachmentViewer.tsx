import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, FileSpreadsheet, Download } from 'lucide-react';
import { logger } from '@/utils/logger';
import type { MessageAttachment } from '@/types/chat.types';
import { Button } from './primitives/Button';
import { Spinner } from './primitives/Spinner';
import { cn } from '@/utils/cn';
import { apiClient } from '@/lib/api';
import { fetchAttachmentBlob, downloadAttachmentFile } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';

interface AttachmentViewerProps {
  attachments?: MessageAttachment[];
  uploadingAttachmentIds?: string[];
}

interface ImageState {
  isLoading: boolean;
  error: boolean;
  imageSrc: string;
}

interface ThumbnailWrapperProps {
  attachment: MessageAttachment;
  onDownload: (url: string, filename: string) => void;
  children: ReactNode;
}

interface IconConfig {
  icon: LucideIcon;
  color: string;
  label: string;
}

const getFileExtension = (filename?: string): string => {
  return filename?.split('.').pop()?.toUpperCase() || '';
};

const getIconConfig = (fileType: string, filename?: string): IconConfig => {
  if (fileType === 'pdf') {
    return {
      icon: FileText,
      color: 'text-error-500 dark:text-error-400',
      label: 'PDF',
    };
  }

  if (fileType === 'xlsx') {
    return {
      icon: FileSpreadsheet,
      color: 'text-success-600 dark:text-success-400',
      label: getFileExtension(filename) || 'XLSX',
    };
  }

  return {
    icon: FileText,
    color: 'text-text-tertiary dark:text-text-dark-tertiary',
    label: 'FILE',
  };
};

const getDefaultFilename = (fileType: string, index: number): string => {
  switch (fileType) {
    case 'pdf':
      return 'document.pdf';
    case 'xlsx':
      return 'spreadsheet.xlsx';
    case 'image':
      return `image-${index}.jpg`;
    default:
      return `file-${index}`;
  }
};

const LoadingProgressOverlay = memo(function LoadingProgressOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded bg-black/35">
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner size="xs" className="text-white" />
      </div>
    </div>
  );
});

const downloadButtonClass =
  'h-5 w-5 rounded-full bg-black/60 text-white shadow-md backdrop-blur-sm hover:bg-black/70 focus-visible:ring-white/70';

function ThumbnailWrapper({ attachment, onDownload, children }: ThumbnailWrapperProps) {
  const filename = attachment.filename || getDefaultFilename(attachment.file_type, 0);

  return (
    <div className="group/thumbnail relative">
      {children}
      <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover/thumbnail:opacity-100">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={(e) => {
            if (attachment.file_type === 'image') {
              e.stopPropagation();
            }
            onDownload(attachment.file_url, filename);
          }}
          className={cn('p-0', downloadButtonClass)}
          aria-label={`Download ${attachment.file_type}`}
        >
          <Download className="h-2.5 w-2.5 text-white" />
        </Button>
      </div>
    </div>
  );
}

function IconThumbnail({
  attachment,
  isLoading = false,
}: {
  attachment: MessageAttachment;
  isLoading?: boolean;
}) {
  const { icon: Icon, color, label } = getIconConfig(attachment.file_type, attachment.filename);

  return (
    <div className="relative flex h-10 w-10 flex-col items-center justify-center rounded border border-border/50 bg-surface-secondary transition-colors hover:bg-surface-hover dark:border-border-dark/50 dark:bg-surface-dark-secondary dark:hover:bg-surface-dark-hover">
      <Icon className={`h-4 w-4 ${color}`} />
      <p className="text-[8px] leading-tight text-text-tertiary dark:text-text-dark-tertiary">
        {label}
      </p>
      {isLoading && <LoadingProgressOverlay />}
    </div>
  );
}

function ImageThumbnail({
  attachment,
  state,
  index,
  isUploading = false,
}: {
  attachment: MessageAttachment;
  state: ImageState;
  index: number;
  isUploading?: boolean;
}) {
  const filename = attachment.filename || getDefaultFilename('image', index);

  if (state.isLoading) {
    return (
      <div className="relative h-10 w-10 rounded bg-surface-secondary dark:bg-surface-dark-secondary">
        <LoadingProgressOverlay />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded border border-border/50 bg-surface-secondary dark:border-border-dark/50 dark:bg-surface-dark-secondary">
        <p className="text-[8px] text-text-tertiary dark:text-text-dark-tertiary">Error</p>
      </div>
    );
  }

  if (state.imageSrc) {
    return (
      <div className="relative inline-block">
        <img
          src={state.imageSrc}
          alt={filename}
          className="block h-10 w-10 cursor-default rounded object-cover"
        />
        {isUploading && <LoadingProgressOverlay />}
      </div>
    );
  }

  return null;
}

function AttachmentViewerInner({ attachments, uploadingAttachmentIds }: AttachmentViewerProps) {
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const ownedObjectUrlsRef = useRef<Set<string>>(new Set());
  const uploadingIdSet = useMemo(
    () => new Set(uploadingAttachmentIds ?? []),
    [uploadingAttachmentIds],
  );

  const handleDownload = useCallback(async (url: string, fileName: string) => {
    if (!url) return;
    try {
      await downloadAttachmentFile(url, fileName, apiClient);
    } catch (error) {
      logger.error('File download failed', 'AttachmentViewer', error);
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!attachments || attachments.length === 0) return;

    const imageAttachments = attachments.filter((a) => a.file_type === 'image');
    if (imageAttachments.length === 0) return;

    const newAttachments = imageAttachments.filter((a) => !loadedIdsRef.current.has(a.id));
    if (newAttachments.length === 0) return;

    const loadImages = async () => {
      for (const attachment of newAttachments) {
        const key = attachment.id;
        loadedIdsRef.current.add(key);

        setImageStates((prev) => ({
          ...prev,
          [key]: { isLoading: true, error: false, imageSrc: '' },
        }));

        try {
          if (isBrowserObjectUrl(attachment.file_url)) {
            setImageStates((prev) => ({
              ...prev,
              [key]: { isLoading: false, error: false, imageSrc: attachment.file_url },
            }));
            continue;
          }

          const blob = await fetchAttachmentBlob(attachment.file_url, apiClient);
          const blobUrl = URL.createObjectURL(blob);
          ownedObjectUrlsRef.current.add(blobUrl);

          setImageStates((prev) => ({
            ...prev,
            [key]: { isLoading: false, error: false, imageSrc: blobUrl },
          }));
        } catch (error) {
          logger.error('Image download failed', 'AttachmentViewer', error);
          loadedIdsRef.current.delete(key);
          setImageStates((prev) => ({
            ...prev,
            [key]: { isLoading: false, error: true, imageSrc: '' },
          }));
        }
      }
    };

    loadImages();
  }, [attachments]);

  useEffect(() => {
    const loadedIds = loadedIdsRef.current;
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      ownedObjectUrls.clear();
      loadedIds.clear();
      setImageStates({});
    };
  }, []);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment, index) => {
        const isUploadingAttachment = uploadingIdSet.has(attachment.id);

        if (attachment.file_type === 'image') {
          const state = imageStates[attachment.id] || {
            isLoading: true,
            error: false,
            imageSrc: '',
          };

          return (
            <ThumbnailWrapper
              key={attachment.id}
              attachment={attachment}
              onDownload={handleDownload}
            >
              <ImageThumbnail
                attachment={attachment}
                state={state}
                index={index}
                isUploading={isUploadingAttachment}
              />
            </ThumbnailWrapper>
          );
        }

        if (attachment.file_type === 'pdf') {
          return (
            <ThumbnailWrapper
              key={attachment.id}
              attachment={attachment}
              onDownload={handleDownload}
            >
              <IconThumbnail attachment={attachment} isLoading={isUploadingAttachment} />
            </ThumbnailWrapper>
          );
        }

        if (attachment.file_type === 'xlsx') {
          return (
            <ThumbnailWrapper
              key={attachment.id}
              attachment={attachment}
              onDownload={handleDownload}
            >
              <IconThumbnail attachment={attachment} isLoading={isUploadingAttachment} />
            </ThumbnailWrapper>
          );
        }

        return null;
      })}
    </div>
  );
}

export const AttachmentViewer = memo(AttachmentViewerInner);
