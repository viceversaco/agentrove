import { useState, useCallback, useEffect, useRef } from 'react';
import { sandboxService } from '@/services/sandboxService';
import { buildChildrenFileStructure, mergeChildrenIntoTree } from '@/utils/file';
import type { Chat as ChatSummary } from '@/types/chat.types';
import type { FileStructure } from '@/types/file-system.types';

interface UseSandboxFilesResult {
  fileStructure: FileStructure[];
  isFileMetadataLoading: boolean;
  refetchFilesMetadata: () => Promise<unknown>;
  loadChildren: (folderPath: string) => Promise<void>;
  loadingPaths: Record<string, boolean>;
}

export function useSandboxFiles(
  currentChat: ChatSummary | undefined,
  chatId: string | undefined,
): UseSandboxFilesResult {
  const sandboxId = currentChat?.sandbox_id || '';
  const [fileStructure, setFileStructure] = useState<FileStructure[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const fetchIdRef = useRef(0);

  const fetchRoot = useCallback(async () => {
    if (!sandboxId) {
      setFileStructure([]);
      return;
    }
    setIsLoading(true);
    const id = ++fetchIdRef.current;
    try {
      const metadata = await sandboxService.getFilesChildren(sandboxId);
      if (id !== fetchIdRef.current) return;
      setFileStructure(buildChildrenFileStructure(metadata));
    } finally {
      if (id === fetchIdRef.current) setIsLoading(false);
    }
  }, [sandboxId]);

  useEffect(() => {
    if (sandboxId && chatId) {
      void fetchRoot();
    } else {
      setFileStructure([]);
    }
  }, [sandboxId, chatId, fetchRoot]);

  const loadChildren = useCallback(
    async (folderPath: string) => {
      if (!sandboxId) return;
      setLoadingPaths((prev) => ({ ...prev, [folderPath]: true }));
      try {
        const metadata = await sandboxService.getFilesChildren(sandboxId, folderPath);
        const children = buildChildrenFileStructure(metadata);
        setFileStructure((prev) => mergeChildrenIntoTree(prev, folderPath, children));
      } finally {
        setLoadingPaths((prev) => ({ ...prev, [folderPath]: false }));
      }
    },
    [sandboxId],
  );

  const refetchFilesMetadata = useCallback(async () => {
    setLoadingPaths({});
    await fetchRoot();
  }, [fetchRoot]);

  return {
    fileStructure,
    isFileMetadataLoading: isLoading,
    refetchFilesMetadata,
    loadChildren,
    loadingPaths,
  };
}
