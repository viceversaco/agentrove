import { createContext, use } from 'react';
import type { FileStructure } from '@/types/file-system.types';

export type FileTreeHandlers = {
  onFileSelect: (file: FileStructure) => void;
  onToggleFolder: (path: string) => void;
};

export interface FileTreeContextValue extends FileTreeHandlers {
  selectedFile: FileStructure | null;
  expandedFolders: Record<string, boolean>;
  modifiedPaths?: Set<string>;
  loadingPaths?: Record<string, boolean>;
}

export const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function useFileTreeContext(component: string) {
  const context = use(FileTreeContext);

  if (!context) {
    throw new Error(`${component} must be used within a FileTreeProvider`);
  }

  return context;
}
