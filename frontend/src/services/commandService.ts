import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import { MAX_UPLOAD_SIZE_BYTES } from '@/config/constants';
import type { CustomCommand } from '@/types/user.types';
import { validateRequired } from '@/utils/validation';

async function uploadCommand(file: File): Promise<CustomCommand> {
  validateRequired(file, 'File');

  if (!file.name.endsWith('.md')) {
    throw new ValidationError('Only markdown (.md) files are allowed');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES.COMMAND) {
    throw new ValidationError('File size must be less than 100KB');
  }

  return withAuth(async () => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.postForm<CustomCommand>('/commands/upload', formData);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteCommand(commandName: string): Promise<void> {
  validateRequired(commandName, 'Command name');

  await withAuth(async () => {
    await apiClient.delete(`/commands/${commandName}`);
  });
}

async function updateCommand(commandName: string, content: string): Promise<CustomCommand> {
  validateRequired(commandName, 'Command name');
  validateRequired(content, 'Content');

  if (content.length > MAX_UPLOAD_SIZE_BYTES.COMMAND) {
    throw new ValidationError('Content too large (max 100KB)');
  }

  return withAuth(async () => {
    const response = await apiClient.put<CustomCommand>(`/commands/${commandName}`, { content });
    return ensureResponse(response, 'Invalid response from server');
  });
}

export const commandService = {
  uploadCommand,
  deleteCommand,
  updateCommand,
};
