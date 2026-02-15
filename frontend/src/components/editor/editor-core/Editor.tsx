import { memo, useState, useCallback, useMemo } from 'react';
import { logger } from '@/utils/logger';
import { CodeView } from '../code-view/CodeView';
import type { FileStructure } from '@/types/file-system.types';
import type { Chat } from '@/types/chat.types';
import { useUIStore } from '@/store/uiStore';
import { sandboxService } from '@/services/sandboxService';

const collectFolderPaths = (items: FileStructure[], validPaths: Set<string>) => {
  items.forEach((item) => {
    if (item.type === 'folder') {
      validPaths.add(item.path);
      if (item.children) {
        collectFolderPaths(item.children, validPaths);
      }
    }
  });
};

export interface EditorProps {
  files: FileStructure[];
  isExpanded: boolean;
  selectedFile: FileStructure | null;
  onFileSelect: (file: FileStructure | null) => void;
  chatId?: string;
  currentChat?: Chat | null;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const Editor = memo(function Editor({
  files,
  onFileSelect,
  selectedFile,
  currentChat,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
}: EditorProps) {
  const theme = useUIStore((state) => state.theme);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const validFolderPaths = useMemo(() => {
    const validPaths = new Set<string>();
    if (files.length > 0) {
      collectFolderPaths(files, validPaths);
    }
    return validPaths;
  }, [files]);

  const currentExpandedFolders = useMemo(() => {
    const newState: Record<string, boolean> = {};

    validFolderPaths.forEach((path) => {
      newState[path] = path in expandedFolders ? expandedFolders[path] : true;
    });

    return newState;
  }, [expandedFolders, validFolderPaths]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const currentValue = path in prev ? prev[path] : true;
      return {
        ...prev,
        [path]: !currentValue,
      };
    });
  }, []);

  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      if (!currentChat?.sandbox_id) {
        return false;
      }

      setIsDownloading(true);

      const zipBlob = await sandboxService.downloadZip(currentChat.sandbox_id);

      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = `sandbox_${currentChat.sandbox_id}_${crypto.randomUUID()}.zip`;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return true;
    } catch (error) {
      logger.error('Sandbox download failed', 'Editor', error);
      return false;
    } finally {
      setIsDownloading(false);
    }
  }, [currentChat?.sandbox_id]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-secondary dark:bg-surface-dark-secondary">
      <CodeView
        files={files}
        selectedFile={selectedFile}
        expandedFolders={currentExpandedFolders}
        onFileSelect={onFileSelect}
        toggleFolder={toggleFolder}
        theme={theme}
        sandboxId={currentChat?.sandbox_id}
        chatId={currentChat?.id}
        onDownload={handleDownload}
        isDownloading={isDownloading}
        isSandboxSyncing={isSandboxSyncing}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />
    </div>
  );
});
