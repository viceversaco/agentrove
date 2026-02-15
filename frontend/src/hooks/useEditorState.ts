import { useState, useCallback } from 'react';
import type { FileStructure } from '@/types/file-system.types';

export function useEditorState(refetchFilesMetadata: () => Promise<unknown>) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileStructure | null>(null);

  const handleFileSelect = useCallback((file: FileStructure | null) => setSelectedFile(file), []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetchFilesMetadata();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchFilesMetadata]);

  return {
    selectedFile,
    setSelectedFile,
    handleFileSelect,
    isRefreshing,
    handleRefresh,
  };
}
