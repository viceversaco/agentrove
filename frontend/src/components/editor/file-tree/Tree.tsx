import { memo, useState, useCallback } from 'react';
import { Header } from './Header';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';
import { Item } from './Item';
import { FileTreeProvider } from './FileTreeProvider';
import { useFileTreeSearch } from '@/hooks/useFileTreeSearch';
import type { FileStructure } from '@/types/file-system.types';
import { hasActualFiles } from '@/utils/file';

export interface TreeProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  expandedFolders: Record<string, boolean>;
  onFileSelect: (file: FileStructure) => void;
  onToggleFolder: (path: string) => void;
  onDownload?: () => void;
  isDownloading?: boolean;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onClose?: () => void;
}

export const Tree = memo(function Tree({
  files,
  selectedFile,
  expandedFolders,
  onFileSelect,
  onToggleFolder,
  onDownload,
  isDownloading = false,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
  onClose,
}: TreeProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const { filteredFiles, matchedPaths, searchExpandedFolders, hasResults } = useFileTreeSearch({
    files,
    searchQuery,
    expandedFolders,
  });

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleSearchClear = useCallback(() => {
    setSearchQuery('');
  }, []);

  const displayFiles = searchQuery.trim() ? filteredFiles : files;
  const mergedExpandedFolders = searchQuery.trim() ? searchExpandedFolders : expandedFolders;

  return (
    <FileTreeProvider
      selectedFile={selectedFile}
      expandedFolders={mergedExpandedFolders}
      onFileSelect={onFileSelect}
      onToggleFolder={onToggleFolder}
    >
      <div className="flex h-full select-none flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
        <Header
          onDownload={onDownload}
          isDownloading={isDownloading}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onSearchClear={handleSearchClear}
          onClose={onClose}
        />

        <div className="flex-1 overflow-hidden">
          <div className="scrollbar-thin scrollbar-thumb-text-quaternary dark:scrollbar-thumb-text-dark-quaternary hover:scrollbar-thumb-text-tertiary dark:hover:scrollbar-thumb-text-dark-tertiary h-full overflow-y-auto">
            <div className="px-2 py-1.5 pb-16">
              {hasActualFiles(files) ? (
                searchQuery.trim() && !hasResults ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
                      No files match "{searchQuery}"
                    </p>
                  </div>
                ) : (
                  <FileTreeItems
                    items={displayFiles}
                    searchQuery={searchQuery}
                    matchedPaths={matchedPaths}
                  />
                )
              ) : isSandboxSyncing ? (
                <LoadingState />
              ) : (
                <EmptyState />
              )}
            </div>
          </div>
        </div>
      </div>
    </FileTreeProvider>
  );
});

interface FileTreeItemsProps {
  items: FileStructure[];
  level?: number;
  searchQuery?: string;
  matchedPaths?: Set<string>;
}

function FileTreeItems({ items, level = 0, searchQuery = '', matchedPaths }: FileTreeItemsProps) {
  return (
    <>
      {items.map((item) => (
        <Item
          key={item.path}
          item={item}
          level={level}
          searchQuery={searchQuery}
          matchedPaths={matchedPaths}
        />
      ))}
    </>
  );
}
