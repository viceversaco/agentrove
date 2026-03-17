import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { FileTreeContext, FileTreeContextValue } from './fileTreeContext';

export interface FileTreeProviderProps extends FileTreeContextValue {
  children: ReactNode;
}

export function FileTreeProvider({
  children,
  selectedFile,
  expandedFolders,
  onFileSelect,
  onToggleFolder,
  modifiedPaths,
  loadingPaths,
}: FileTreeProviderProps) {
  const value = useMemo(
    () => ({
      selectedFile,
      expandedFolders,
      onFileSelect,
      onToggleFolder,
      modifiedPaths,
      loadingPaths,
    }),
    [selectedFile, expandedFolders, onFileSelect, onToggleFolder, modifiedPaths, loadingPaths],
  );

  return <FileTreeContext.Provider value={value}>{children}</FileTreeContext.Provider>;
}
