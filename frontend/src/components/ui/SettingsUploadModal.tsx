import type { ElementType } from 'react';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Upload, X } from 'lucide-react';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';

interface SettingsUploadModalProps {
  isOpen: boolean;
  error: string | null;
  uploading: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
  title: string;
  acceptedExtension: string;
  icon: ElementType;
  hintText: string;
}

export const SettingsUploadModal = ({
  isOpen,
  error,
  uploading,
  onClose,
  onUpload,
  title,
  acceptedExtension,
  icon: Icon,
  hintText,
}: SettingsUploadModalProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFilesDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (file && file.name.endsWith(acceptedExtension)) {
        setSelectedFile(file);
      }
    },
    [acceptedExtension],
  );

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFilesDrop: handleFilesDrop,
    disabled: uploading,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSubmit = async () => {
    if (selectedFile) {
      await onUpload(selectedFile);
      setSelectedFile(null);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-strong dark:border-border-dark dark:bg-surface-dark">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 dark:border-border-dark">
          <h2 className="text-sm font-semibold text-text-primary dark:text-text-dark-primary">
            {title}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div
            className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200 ${
              isDragging
                ? 'border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary'
                : 'border-border dark:border-border-dark'
            }`}
            {...dragHandlers}
          >
            {selectedFile ? (
              <div>
                <Icon className="mx-auto mb-2 h-8 w-8 text-text-secondary dark:text-text-dark-secondary" />
                <p className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <Upload className="mx-auto mb-2 h-6 w-6 text-text-quaternary dark:text-text-dark-quaternary" />
                <p className="mb-1 text-xs text-text-secondary dark:text-text-dark-secondary">
                  Drop your {acceptedExtension} file here or
                </p>
                <label className="cursor-pointer text-xs text-text-primary underline-offset-2 transition-colors duration-200 hover:underline dark:text-text-dark-primary">
                  browse files
                  <input
                    type="file"
                    accept={acceptedExtension}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface-secondary p-3 dark:border-border-dark dark:bg-surface-dark-secondary">
            <p className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">{hintText}</p>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-2">
            <div className="rounded-xl border border-border p-3 dark:border-border-dark">
              <p className="text-xs text-text-secondary dark:text-text-dark-secondary">{error}</p>
            </div>
          </div>
        )}

        <div className="flex gap-2 border-t border-border px-5 py-3 dark:border-border-dark">
          <Button onClick={handleClose} variant="outline" size="sm" className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="outline"
            size="sm"
            className="flex-1 border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
            disabled={!selectedFile || uploading}
            isLoading={uploading}
          >
            Upload
          </Button>
        </div>
      </div>
    </div>
  );
};
