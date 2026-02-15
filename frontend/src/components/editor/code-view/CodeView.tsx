import { memo, useState, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Tree } from '../file-tree/Tree';
import { View } from '../editor-view/View';
import type { FileStructure } from '@/types/file-system.types';
import { cn } from '@/utils/cn';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface CodeViewProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  expandedFolders: Record<string, boolean>;
  onFileSelect: (file: FileStructure | null) => void;
  toggleFolder: (path: string) => void;
  theme: string;
  sandboxId?: string;
  chatId?: string;
  onDownload?: () => void;
  isDownloading?: boolean;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const CodeView = memo(function CodeView({
  files,
  selectedFile,
  expandedFolders,
  onFileSelect,
  toggleFolder,
  theme,
  sandboxId,
  chatId,
  onDownload,
  isDownloading,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
}: CodeViewProps) {
  const backgroundClass = theme === 'light' ? 'bg-surface-secondary' : 'bg-surface-dark-secondary';
  const isMobile = useIsMobile();
  const [showMobileTree, setShowMobileTree] = useState(false);

  const handleMobileFileSelect = useCallback(
    (file: FileStructure | null) => {
      onFileSelect(file);
      if (file && file.type === 'file') {
        setShowMobileTree(false);
      }
    },
    [onFileSelect],
  );

  if (isMobile) {
    return (
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', backgroundClass)}>
        {showMobileTree && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/50"
              onClick={() => setShowMobileTree(false)}
            />
            <div
              className={cn(
                'absolute left-0 top-0 z-30 h-full w-72',
                'border-r border-border dark:border-border-dark',
                backgroundClass,
              )}
            >
              <Tree
                files={files}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onFileSelect={handleMobileFileSelect}
                onToggleFolder={toggleFolder}
                onDownload={onDownload}
                isDownloading={isDownloading}
                isSandboxSyncing={isSandboxSyncing}
                onRefresh={onRefresh}
                isRefreshing={isRefreshing}
                onClose={() => setShowMobileTree(false)}
              />
            </div>
          </>
        )}

        <div className={cn('min-h-0 flex-1 overflow-hidden', backgroundClass)}>
          <View
            selectedFile={selectedFile}
            fileStructure={files}
            sandboxId={sandboxId}
            chatId={chatId}
            onToggleFileTree={() => setShowMobileTree(true)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <PanelGroup direction="horizontal" autoSaveId="code-view-layout">
        <Panel defaultSize={20} minSize={15} maxSize={40}>
          <div
            className={`h-full overflow-hidden border-r border-border dark:border-border-dark ${backgroundClass}`}
          >
            <Tree
              files={files}
              selectedFile={selectedFile}
              expandedFolders={expandedFolders}
              onFileSelect={onFileSelect}
              onToggleFolder={toggleFolder}
              onDownload={onDownload}
              isDownloading={isDownloading}
              isSandboxSyncing={isSandboxSyncing}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
            />
          </div>
        </Panel>

        <PanelResizeHandle
          className={cn(
            'group relative w-px',
            'bg-border/50 dark:bg-border-dark/50',
            'hover:bg-text-quaternary/50 dark:hover:bg-text-dark-quaternary/50',
            'transition-colors duration-200',
          )}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
        </PanelResizeHandle>

        <Panel>
          <div className={`h-full overflow-hidden ${backgroundClass}`}>
            <View
              selectedFile={selectedFile}
              fileStructure={files}
              sandboxId={sandboxId}
              chatId={chatId}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
});
