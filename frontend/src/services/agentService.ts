import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import { MAX_UPLOAD_SIZE_BYTES } from '@/config/constants';
import type { CustomAgent } from '@/types/user.types';
import { validateRequired } from '@/utils/validation';

async function uploadAgent(file: File): Promise<CustomAgent> {
  validateRequired(file, 'File');

  if (!file.name.endsWith('.md')) {
    throw new ValidationError('Only markdown (.md) files are allowed');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES.AGENT) {
    throw new ValidationError('File size must be less than 100KB');
  }

  return withAuth(async () => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.postForm<CustomAgent>('/agents/upload', formData);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteAgent(agentName: string): Promise<void> {
  validateRequired(agentName, 'Agent name');

  await withAuth(async () => {
    await apiClient.delete(`/agents/${agentName}`);
  });
}

async function updateAgent(agentName: string, content: string): Promise<CustomAgent> {
  validateRequired(agentName, 'Agent name');
  validateRequired(content, 'Content');

  if (content.length > MAX_UPLOAD_SIZE_BYTES.AGENT) {
    throw new ValidationError('Content too large (max 100KB)');
  }

  return withAuth(async () => {
    const response = await apiClient.put<CustomAgent>(`/agents/${agentName}`, { content });
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const agentService = {
  uploadAgent,
  deleteAgent,
  updateAgent,
};
