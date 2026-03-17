import type { FileStructure } from '@/types/file-system.types';
import toast from 'react-hot-toast';
import { logger } from '@/utils/logger';
import { isSupportedUploadedFile } from '@/utils/fileTypes';
import { MAX_UPLOAD_SIZE_BYTES } from '@/config/constants';
import {
  isApiAttachmentUrl,
  isBrowserObjectUrl,
  toApiEndpoint,
  toDownloadUrl,
} from '@/utils/attachmentUrl';

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  json: 'json',
  py: 'python',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  sql: 'sql',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  txt: 'plaintext',
  xml: 'xml',
  graphql: 'graphql',
  gql: 'graphql',
  svelte: 'svelte',
  vue: 'vue',
  astro: 'astro',
};

const LEADING_SLASH_RE = /^\.?\/+/;

export function sortFiles(files: FileStructure[]): FileStructure[] {
  const sorted = [...files].sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.path.localeCompare(b.path);
  });

  return sorted.map((item) =>
    item.type === 'folder' && item.children
      ? { ...item, children: sortFiles(item.children) }
      : item,
  );
}

export function buildChildrenFileStructure(
  metadata: Array<{
    path: string;
    type: string;
    is_binary?: boolean;
    size?: number;
    modified?: number;
    has_children?: boolean;
  }>,
): FileStructure[] {
  const items: FileStructure[] = metadata.map((m) => {
    const normalizedPath = m.path.replace(LEADING_SLASH_RE, '');
    if (m.type === 'directory') {
      return {
        path: normalizedPath,
        content: '',
        type: 'folder' as const,
        size: m.size,
        modified: m.modified,
        isLoaded: false,
        has_children: m.has_children ?? true,
        children: [],
      };
    }
    return {
      path: normalizedPath,
      content: '',
      type: 'file' as const,
      is_binary: m.is_binary,
      size: m.size,
      modified: m.modified,
      isLoaded: false,
    };
  });
  return sortFiles(items);
}

export function mergeChildrenIntoTree(
  tree: FileStructure[],
  parentPath: string,
  children: FileStructure[],
): FileStructure[] {
  return tree.map((node) => {
    if (node.path === parentPath && node.type === 'folder') {
      return { ...node, children, isLoaded: true };
    }
    if (node.type === 'folder' && node.children && parentPath.startsWith(node.path + '/')) {
      return { ...node, children: mergeChildrenIntoTree(node.children, parentPath, children) };
    }
    return node;
  });
}

export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

export function findFileInStructure(
  items: FileStructure[],
  path: string,
): FileStructure | undefined {
  for (const file of items) {
    if (file.path === path) return file;
    if (file.type === 'folder' && file.children) {
      const found = findFileInStructure(file.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

// Tool paths are absolute (/home/user/project/src/foo.ts), tree paths are relative (src/foo.ts).
// Try the exact path first, then progressively strip leading segments to find a match.
export function findFileByToolPath(
  items: FileStructure[],
  toolPath: string,
): FileStructure | undefined {
  const found = findFileInStructure(items, toolPath);
  if (found) return found;

  if (!toolPath.startsWith('/')) return undefined;

  const parts = toolPath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const candidate = findFileInStructure(items, parts.slice(i).join('/'));
    if (candidate) return candidate;
  }
  return undefined;
}

export function detectLanguage(path: string): string {
  if (!path) return 'javascript';

  const extension = path.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[extension] || 'plaintext';
}

export function filterChatAttachmentFiles(
  files: File[],
  { toastOnError = true }: { toastOnError?: boolean } = {},
): File[] {
  const supportedFiles = files.filter(isSupportedUploadedFile);
  const validFiles: File[] = [];
  const oversizedFiles: File[] = [];

  for (const file of supportedFiles) {
    if (file.size > MAX_UPLOAD_SIZE_BYTES.CHAT_ATTACHMENT) {
      oversizedFiles.push(file);
    } else {
      validFiles.push(file);
    }
  }

  if (toastOnError && oversizedFiles.length > 0) {
    const maxSizeMB = MAX_UPLOAD_SIZE_BYTES.CHAT_ATTACHMENT / (1024 * 1024);
    if (oversizedFiles.length === 1) {
      toast.error(`File "${oversizedFiles[0].name}" exceeds ${maxSizeMB}MB limit`);
    } else {
      toast.error(`${oversizedFiles.length} files exceed ${maxSizeMB}MB limit`);
    }
  }

  return validFiles;
}

const buildPathMap = (files: FileStructure[], pathToFile: Map<string, FileStructure>) => {
  files.forEach((file) => {
    pathToFile.set(file.path, file);
    if (file.type === 'folder' && file.children) {
      buildPathMap(file.children, pathToFile);
    }
  });
};

const createDirectoryPath = (
  dirPath: string,
  pathToFile: Map<string, FileStructure>,
  newFileStructure: FileStructure[],
) => {
  const normalizedDirPath = dirPath.replace(LEADING_SLASH_RE, '');
  if (!normalizedDirPath) return;

  const pathParts = normalizedDirPath.split('/').filter((part) => part);
  let currentPath = '';

  pathParts.forEach((part) => {
    const parentPath = currentPath;
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    if (!pathToFile.has(currentPath)) {
      const newDir: FileStructure = {
        path: currentPath,
        type: 'folder',
        content: '',
        children: [],
      };

      pathToFile.set(currentPath, newDir);

      if (parentPath) {
        const parent = pathToFile.get(parentPath);
        if (parent && parent.children) {
          parent.children.push(newDir);
        }
      } else {
        newFileStructure.push(newDir);
      }
    }
  });
};

export function buildFileStructureFromSandboxFiles(
  sandboxFiles: Array<{
    path: string;
    content?: string;
    type: string;
    is_binary?: boolean;
    size?: number;
    modified?: number;
  }>,
  existingFileStructure: FileStructure[] = [],
): FileStructure[] {
  if (!Array.isArray(sandboxFiles)) {
    return existingFileStructure;
  }

  const newFileStructure: FileStructure[] =
    typeof structuredClone === 'function'
      ? structuredClone(existingFileStructure)
      : JSON.parse(JSON.stringify(existingFileStructure));
  const pathToFile: Map<string, FileStructure> = new Map();

  buildPathMap(newFileStructure, pathToFile);

  sandboxFiles.forEach((file) => {
    try {
      const normalizedPath = file.path.replace(LEADING_SLASH_RE, '');
      if (!normalizedPath) {
        return;
      }

      if (file.type === 'directory') {
        createDirectoryPath(normalizedPath, pathToFile, newFileStructure);
      } else if (file.type === 'file') {
        if (pathToFile.has(normalizedPath)) {
          return;
        }

        const pathParts = normalizedPath.split('/');
        pathParts.pop();
        const dirPath = pathParts.join('/');

        const newFile: FileStructure = {
          path: normalizedPath,
          type: 'file',
          content: file.content || '',
          is_binary: file.is_binary,
          size: file.size,
          modified: file.modified,
          isLoaded: !!file.content,
        };

        if (dirPath) {
          createDirectoryPath(dirPath, pathToFile, newFileStructure);
          const parent = pathToFile.get(dirPath);
          if (parent && parent.children) {
            parent.children.push(newFile);
          }
        } else {
          newFileStructure.push(newFile);
        }

        pathToFile.set(normalizedPath, newFile);
      }
    } catch (error) {
      logger.error('File structure build failed', 'file', error);
    }
  });

  return sortFiles(newFileStructure);
}

export function hasActualFiles(files: FileStructure[]): boolean {
  for (const file of files) {
    if (file.type === 'file') {
      return true;
    }
    if (file.type === 'folder' && file.children && hasActualFiles(file.children)) {
      return true;
    }
  }
  return false;
}

export function traverseFileStructure<T>(
  items: FileStructure[],
  processor: (item: FileStructure, parentPath: string) => T | null,
  parentPath = '',
): T[] {
  const result: T[] = [];

  items.forEach((item) => {
    const processed = processor(item, parentPath);
    if (processed !== null) {
      result.push(processed);
    }

    if (item.type === 'folder' && item.children) {
      result.push(...traverseFileStructure(item.children, processor, item.path));
    }
  });

  return result;
}

export async function fetchAttachmentBlob(
  fileUrl: string,
  apiClient: { getBlob: (endpoint: string, signal?: AbortSignal) => Promise<Blob> },
  signal?: AbortSignal,
): Promise<Blob> {
  if (isApiAttachmentUrl(fileUrl)) {
    return apiClient.getBlob(toApiEndpoint(fileUrl), signal);
  }
  const response = await fetch(fileUrl, { signal });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  return response.blob();
}

export async function downloadAttachmentFile(
  fileUrl: string,
  fileName: string,
  apiClient: { getBlob: (endpoint: string, signal?: AbortSignal) => Promise<Blob> },
): Promise<void> {
  if (isBrowserObjectUrl(fileUrl)) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  const downloadUrl = toDownloadUrl(fileUrl);
  const blob = await fetchAttachmentBlob(downloadUrl, apiClient);
  const blobUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export const convertDataUrlToUploadedFile = async (
  dataUrl: string,
  filename: string = 'image.png',
  type: string = 'image/png',
): Promise<File> => {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type });
};
