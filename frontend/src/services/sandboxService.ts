import { apiClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import { NotFoundError, ValidationError } from '@/services/base/ServiceError';
import type { PreviewLinksResponse } from '@/types/chat.types';
import type {
  DiffMode,
  FileContent,
  FileMetadata,
  GitBranchesData,
  GitCheckoutData,
  GitDiffData,
  GitWorktreesData,
  PortInfo,
  Secret,
  UpdateFileResult,
} from '@/types/sandbox.types';
import { logger } from '@/utils/logger';
import { validateRequired } from '@/utils/validation';

async function getPreviewLinks(sandboxId: string): Promise<PortInfo[]> {
  validateRequired(sandboxId, 'Sandbox ID');

  try {
    return await serviceCall(async () => {
      const response = await apiClient.get<PreviewLinksResponse>(
        `/sandbox/${sandboxId}/preview-links`,
      );
      if (!response || !response.links) {
        return [];
      }

      return response.links.map((link) => ({
        port: link.port,
        previewUrl: link.preview_url,
      }));
    });
  } catch (error) {
    logger.error('Preview links fetch failed', 'sandboxService', error);
    return [];
  }
}

async function getSandboxFilesMetadata(sandboxId: string): Promise<FileMetadata[]> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const url = `/sandbox/${sandboxId}/files/metadata`;
    const response = await apiClient.get<{ files: FileMetadata[] }>(url);

    if (!response || !response.files) {
      return [];
    }

    return response.files;
  });
}

async function getFileContent(sandboxId: string, filePath: string): Promise<FileContent> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(filePath, 'File path');

  return serviceCall(async () => {
    const url = `/sandbox/${sandboxId}/files/content/${filePath}`;
    const response = await apiClient.get<FileContent>(url);

    if (!response) {
      throw new NotFoundError('File not found');
    }

    return response;
  });
}

async function updateFile(
  sandboxId: string,
  filePath: string,
  content: string,
): Promise<UpdateFileResult> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(filePath, 'File path');
  if (content === null || content === undefined) {
    throw new ValidationError('Content is required');
  }

  return serviceCall(async () => {
    const response = await apiClient.put<UpdateFileResult>(`/sandbox/${sandboxId}/files`, {
      file_path: filePath,
      content,
    });

    return ensureResponse(response, 'Update file operation returned no response');
  });
}

async function getSecrets(sandboxId: string): Promise<Secret[]> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.get<{ secrets: Secret[] }>(`/sandbox/${sandboxId}/secrets`);

    if (!response || !response.secrets) {
      return [];
    }

    return response.secrets;
  });
}

async function addSecret(sandboxId: string, key: string, value: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');
  validateRequired(value, 'Secret value');

  await serviceCall(async () => {
    await apiClient.post(`/sandbox/${sandboxId}/secrets`, { key, value });
  });
}

async function updateSecret(sandboxId: string, key: string, value: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');
  validateRequired(value, 'Secret value');

  await serviceCall(async () => {
    await apiClient.put(`/sandbox/${sandboxId}/secrets/${key}`, { value });
  });
}

async function deleteSecret(sandboxId: string, key: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(key, 'Secret key');

  await serviceCall(async () => {
    await apiClient.delete(`/sandbox/${sandboxId}/secrets/${key}`);
  });
}

async function downloadZip(sandboxId: string): Promise<Blob> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.getBlob(`/sandbox/${sandboxId}/download-zip`);
    return ensureResponse(response, 'Download failed: No response received');
  });
}

async function updateIDETheme(sandboxId: string, theme: 'dark' | 'light'): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');

  await serviceCall(async () => {
    await apiClient.put(`/sandbox/${sandboxId}/ide-theme`, { theme });
  });
}

async function getIDEUrl(sandboxId: string): Promise<string | null> {
  validateRequired(sandboxId, 'Sandbox ID');

  try {
    return await serviceCall(async () => {
      const response = await apiClient.get<{ url: string | null }>(`/sandbox/${sandboxId}/ide-url`);
      return response?.url ?? null;
    });
  } catch (error) {
    logger.error('IDE URL fetch failed', 'sandboxService', error);
    return null;
  }
}

interface BrowserStatus {
  running: boolean;
  current_url?: string;
}

interface VNCUrlResponse {
  url: string | null;
}

async function getVNCUrl(sandboxId: string): Promise<string | null> {
  validateRequired(sandboxId, 'Sandbox ID');

  try {
    return await serviceCall(async () => {
      const response = await apiClient.get<VNCUrlResponse>(`/sandbox/${sandboxId}/vnc-url`);
      return response?.url ?? null;
    });
  } catch (error) {
    logger.error('VNC URL fetch failed', 'sandboxService', error);
    return null;
  }
}

async function startBrowser(
  sandboxId: string,
  url: string = 'about:blank',
): Promise<BrowserStatus> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.post<BrowserStatus>(`/sandbox/${sandboxId}/browser/start`, {
      url,
    });
    return response ?? { running: true, current_url: url };
  });
}

async function stopBrowser(sandboxId: string): Promise<void> {
  validateRequired(sandboxId, 'Sandbox ID');

  await serviceCall(async () => {
    await apiClient.post(`/sandbox/${sandboxId}/browser/stop`);
  });
}

async function getBrowserStatus(sandboxId: string): Promise<BrowserStatus> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.get<BrowserStatus>(`/sandbox/${sandboxId}/browser/status`);
    return response ?? { running: false };
  });
}

async function getGitDiff(
  sandboxId: string,
  mode: DiffMode = 'all',
  fullContext: boolean = false,
  cwd?: string,
): Promise<GitDiffData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const qs = buildQueryString({
      mode,
      full_context: fullContext || undefined,
      cwd: cwd || undefined,
    });
    const response = await apiClient.get<GitDiffData>(`/sandbox/${sandboxId}/git/diff${qs}`);
    return response ?? { diff: '', has_changes: false, is_git_repo: false };
  });
}

async function getGitWorktrees(sandboxId: string): Promise<GitWorktreesData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.get<GitWorktreesData>(`/sandbox/${sandboxId}/git/worktrees`);
    return response ?? { worktrees: [] };
  });
}

async function getGitBranches(sandboxId: string): Promise<GitBranchesData> {
  validateRequired(sandboxId, 'Sandbox ID');

  return serviceCall(async () => {
    const response = await apiClient.get<GitBranchesData>(`/sandbox/${sandboxId}/git/branches`);
    return response ?? { branches: [], current_branch: '', is_git_repo: false };
  });
}

async function checkoutGitBranch(sandboxId: string, branch: string): Promise<GitCheckoutData> {
  validateRequired(sandboxId, 'Sandbox ID');
  validateRequired(branch, 'Branch name');

  return serviceCall(async () => {
    const response = await apiClient.post<GitCheckoutData>(`/sandbox/${sandboxId}/git/checkout`, {
      branch,
    });
    return ensureResponse(response, 'Checkout failed');
  });
}

export const sandboxService = {
  getPreviewLinks,
  getSandboxFilesMetadata,
  getFileContent,
  updateFile,
  getSecrets,
  addSecret,
  updateSecret,
  deleteSecret,
  downloadZip,
  updateIDETheme,
  getIDEUrl,
  getVNCUrl,
  startBrowser,
  stopBrowser,
  getBrowserStatus,
  getGitDiff,
  getGitBranches,
  getGitWorktrees,
  checkoutGitBranch,
};
