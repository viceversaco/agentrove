import { apiClient } from '@/lib/api';
import { ensureResponse, serviceCall, buildQueryString } from '@/services/base/BaseService';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'directory';
}

export interface DirectoryBrowseResponse {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
}

async function browseDirectory(path?: string): Promise<DirectoryBrowseResponse> {
  return serviceCall(async () => {
    const qs = buildQueryString(path ? { path } : {});
    const response = await apiClient.get<DirectoryBrowseResponse>(`/filesystem/browse${qs}`);
    return ensureResponse(response, 'Failed to browse directory');
  });
}

export const filesystemService = { browseDirectory };
