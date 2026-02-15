import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { X, Pencil, Check, FileText, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { apiClient } from '@/lib/api';
import { detectFileType } from '@/utils/fileTypes';
import { fetchAttachmentBlob } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import type {
  LocalQueuedMessage,
  QueueMessageAttachment as QueueAttachment,
} from '@/types/queue.types';

interface PendingMessageProps {
  message: LocalQueuedMessage;
  onCancel: () => void;
  onEdit: (newContent: string) => void;
}

function UploadingOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-lg bg-black/35">
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner size="xs" className="text-white" />
      </div>
    </div>
  );
}

function LocalUploadingPreview({ file }: { file: File }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'pdf' | 'xlsx' | 'unknown'>('unknown');

  useEffect(() => {
    let objectUrl: string | null = null;

    try {
      const detectedType = detectFileType(file.name, file.type);
      setFileType(detectedType);

      if (detectedType === 'image') {
        objectUrl = URL.createObjectURL(file);
        setImageSrc(objectUrl);
      }
    } catch {
      setFileType('unknown');
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file]);

  if (fileType === 'image' && imageSrc) {
    return (
      <div className="relative h-14 w-14 rounded-lg">
        <img
          src={imageSrc}
          alt={file.name || 'Attachment'}
          className="h-14 w-14 rounded-lg object-cover"
        />
        <UploadingOverlay />
      </div>
    );
  }

  if (fileType === 'xlsx') {
    return (
      <div className="relative flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <FileSpreadsheet className="h-6 w-6 text-success-600 dark:text-success-400" />
        <span className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          Excel
        </span>
        <UploadingOverlay />
      </div>
    );
  }

  if (fileType === 'pdf') {
    return (
      <div className="relative flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <FileText className="h-6 w-6 text-error-500 dark:text-error-400" />
        <span className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">PDF</span>
        <UploadingOverlay />
      </div>
    );
  }

  return (
    <div className="relative flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
      <FileText className="h-6 w-6 text-text-tertiary dark:text-text-dark-tertiary" />
      <span className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">File</span>
      <UploadingOverlay />
    </div>
  );
}

function AuthenticatedPreview({ attachment }: { attachment: QueueAttachment }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadImage() {
      try {
        if (isBrowserObjectUrl(attachment.file_url)) {
          setImageSrc(attachment.file_url);
          setIsLoading(false);
          return;
        }

        const blob = await fetchAttachmentBlob(attachment.file_url, apiClient);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setIsLoading(false);
        }
      }
    }

    if (attachment.file_type === 'image') {
      loadImage();
    } else {
      setIsLoading(false);
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file_url, attachment.file_type]);

  if (attachment.file_type === 'pdf') {
    return (
      <div className="flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <FileText className="h-6 w-6 text-error-500 dark:text-error-400" />
        <span className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">PDF</span>
      </div>
    );
  }

  if (attachment.file_type === 'xlsx') {
    return (
      <div className="flex h-14 w-14 flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <FileSpreadsheet className="h-6 w-6 text-success-600 dark:text-success-400" />
        <span className="mt-0.5 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          Excel
        </span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <div className="h-4 w-4 animate-pulse rounded-full bg-text-quaternary dark:bg-text-dark-quaternary" />
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary">
        <span className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">Error</span>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={attachment.filename || 'Attachment'}
      className="h-14 w-14 rounded-lg object-cover"
    />
  );
}

export const PendingMessage = memo(function PendingMessage({
  message,
  onCancel,
  onEdit,
}: PendingMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasLocalFiles = message.files && message.files.length > 0;
  const hasServerAttachments = message.attachments && message.attachments.length > 0;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(false);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editContent.trim();
    if (!trimmed) {
      onCancel();
    } else {
      onEdit(trimmed);
    }
    setIsEditing(false);
  }, [editContent, onCancel, onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  return (
    <div className="group px-4 py-1.5 sm:px-6 sm:py-2">
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          {hasLocalFiles && !hasServerAttachments && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.files!.map((file, idx) => (
                <LocalUploadingPreview
                  key={`${file.name}-${file.lastModified}-${idx}`}
                  file={file}
                />
              ))}
            </div>
          )}
          {hasServerAttachments && message.attachments && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((att, idx) => (
                <AuthenticatedPreview key={att.file_url || idx} attachment={att} />
              ))}
            </div>
          )}

          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <div className="inline-block max-w-full rounded-xl border border-border-hover bg-surface-hover/60 dark:border-border-dark-hover dark:bg-surface-dark-tertiary/80">
                <textarea
                  ref={textareaRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full resize-none bg-transparent px-3 py-1.5 text-sm leading-5 text-text-primary placeholder:text-text-quaternary focus:outline-none dark:text-text-dark-primary"
                  rows={1}
                />
              </div>
              <Button
                onClick={handleSaveEdit}
                variant="unstyled"
                className="rounded-md p-1 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                aria-label="Save edit"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                onClick={handleCancelEdit}
                variant="unstyled"
                className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-error-100 hover:text-error-600 dark:text-text-dark-quaternary dark:hover:bg-error-500/10 dark:hover:text-error-400"
                aria-label="Cancel edit"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="inline-block max-w-full rounded-xl bg-surface-hover/60 px-3 py-1.5 dark:bg-surface-dark-tertiary/80">
                <p className="whitespace-pre-wrap text-sm leading-5 text-text-primary dark:text-text-dark-primary">
                  {message.content}
                </p>
              </div>
              <span className="animate-pulse-slow text-2xs font-medium text-text-quaternary dark:text-text-dark-quaternary">
                Queued
              </span>
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <Button
                  onClick={handleStartEdit}
                  variant="unstyled"
                  className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                  aria-label="Edit message"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  onClick={onCancel}
                  variant="unstyled"
                  className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-error-100 hover:text-error-600 dark:text-text-dark-quaternary dark:hover:bg-error-500/10 dark:hover:text-error-400"
                  aria-label="Cancel message"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
