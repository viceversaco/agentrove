import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth, buildQueryString } from '@/services/base/BaseService';
import type { GitHubReposResponse } from '@/types/github.types';

async function searchRepositories(
  query: string,
  page: number,
  perPage: number,
): Promise<GitHubReposResponse> {
  return withAuth(async () => {
    const qs = buildQueryString({ q: query, page, per_page: perPage });
    const response = await apiClient.get<GitHubReposResponse>(`/github/repositories${qs}`);
    return ensureResponse(response, 'Failed to fetch GitHub repositories');
  });
}

export const githubService = {
  searchRepositories,
};
