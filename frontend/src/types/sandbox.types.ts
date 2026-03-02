export interface Secret {
  key: string;
  value: string;
  originalKey?: string;
  originalValue?: string;
  isNew?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface PortInfo {
  port: number;
  previewUrl: string;
}

export interface FileMetadata {
  path: string;
  type: string;
  is_binary?: boolean;
  size: number;
  modified: number;
}

export interface FileContent {
  path: string;
  content: string;
  type: string;
  is_binary: boolean;
}

export interface UpdateFileResult {
  success: boolean;
  message: string;
}

export type DiffMode = 'all' | 'staged' | 'unstaged' | 'branch';

export interface GitDiffData {
  diff: string;
  has_changes: boolean;
  is_git_repo: boolean;
  error?: string;
}
