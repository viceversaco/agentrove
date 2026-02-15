import { useDeferredValue, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import { traverseFileStructure, getFileName } from '@/utils/file';
import { fuzzySearch } from '@/utils/fuzzySearch';

interface FileItem {
  path: string;
  name: string;
  type: 'file' | 'folder';
  parentPath: string;
}

interface UseFileTreeSearchOptions {
  files: FileStructure[];
  searchQuery: string;
  expandedFolders: Record<string, boolean>;
}

interface UseFileTreeSearchResult {
  filteredFiles: FileStructure[];
  matchedPaths: Set<string>;
  searchExpandedFolders: Record<string, boolean>;
  hasResults: boolean;
}

const flattenFileStructure = (files: FileStructure[]): FileItem[] => {
  return traverseFileStructure(files, (item, parentPath) => ({
    path: item.path,
    name: getFileName(item.path),
    type: item.type,
    parentPath,
  }));
};

// Extracts all parent folder paths from matched files to auto-expand them.
// For "src/components/Button.tsx", marks "src" and "src/components" as expanded.
const getFoldersToExpand = (matchedFiles: FileItem[]): Record<string, boolean> => {
  const foldersToExpand: Record<string, boolean> = {};

  matchedFiles.forEach((file) => {
    const pathParts = file.path.split('/');

    // Build all parent paths (excluding the file itself)
    for (let i = 1; i < pathParts.length; i++) {
      const folderPath = pathParts.slice(0, i).join('/');
      if (folderPath) {
        foldersToExpand[folderPath] = true;
      }
    }
  });

  return foldersToExpand;
};

// Recursively checks if a folder contains any matched files in its subtree.
// A folder is included if it or any of its descendants match the search.
const shouldIncludeFolder = (folder: FileStructure, matchedPaths: Set<string>): boolean => {
  if (matchedPaths.has(folder.path)) return true;
  if (!folder.children) return false;

  return folder.children.some((child) => {
    if (child.type === 'file') {
      return matchedPaths.has(child.path);
    }
    return shouldIncludeFolder(child, matchedPaths);
  });
};

// Filters file structure while preserving tree hierarchy.
// Keeps files that match and folders that contain matches (recursively).
// Unlike a flat filter, this maintains parent-child relationships.
const filterItems = (items: FileStructure[], matchedPaths: Set<string>): FileStructure[] => {
  return items
    .filter((item) => {
      if (item.type === 'file') {
        return matchedPaths.has(item.path);
      }
      return shouldIncludeFolder(item, matchedPaths);
    })
    .map((item) => {
      // Recursively filter folder children
      if (item.type === 'folder' && item.children) {
        return {
          ...item,
          children: filterItems(item.children, matchedPaths),
        };
      }
      return item;
    });
};

const filterFileStructure = (
  files: FileStructure[],
  matchedPaths: Set<string>,
): FileStructure[] => {
  return filterItems(files, matchedPaths);
};

export const useFileTreeSearch = ({
  files,
  searchQuery,
  expandedFolders,
}: UseFileTreeSearchOptions): UseFileTreeSearchResult => {
  const deferredQuery = useDeferredValue(searchQuery);
  const flattenedFiles = useMemo(() => flattenFileStructure(files), [files]);

  const searchResults = useMemo(() => {
    const trimmedQuery = deferredQuery.trim();

    if (!trimmedQuery) {
      return {
        matchedFiles: [] as FileItem[],
        matchedPaths: new Set<string>(),
      };
    }

    const matchedFiles = fuzzySearch(trimmedQuery, flattenedFiles, {
      keys: ['name', 'path'],
      limit: 1000,
    });
    const matchedPaths = new Set(matchedFiles.map((file) => file.path));

    return { matchedFiles, matchedPaths };
  }, [deferredQuery, flattenedFiles]);

  const searchExpandedFolders = useMemo(() => {
    if (searchResults.matchedFiles.length === 0) {
      return {};
    }

    return getFoldersToExpand(searchResults.matchedFiles);
  }, [searchResults.matchedFiles]);

  const filteredFiles = useMemo(() => {
    if (!deferredQuery.trim()) {
      return files;
    }

    if (searchResults.matchedPaths.size === 0) {
      return [];
    }

    return filterFileStructure(files, searchResults.matchedPaths);
  }, [files, deferredQuery, searchResults.matchedPaths]);

  const mergedExpandedFolders = useMemo(() => {
    return {
      ...expandedFolders,
      ...searchExpandedFolders,
    };
  }, [expandedFolders, searchExpandedFolders]);

  return {
    filteredFiles,
    matchedPaths: searchResults.matchedPaths,
    searchExpandedFolders: mergedExpandedFolders,
    hasResults: searchResults.matchedPaths.size > 0 || !deferredQuery.trim(),
  };
};
