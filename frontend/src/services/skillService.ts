import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import { MAX_UPLOAD_SIZE_BYTES } from '@/config/constants';
import type { CustomSkill } from '@/types/user.types';
import { validateRequired } from '@/utils/validation';

async function uploadSkill(file: File): Promise<CustomSkill> {
  validateRequired(file, 'File');

  if (!file.name.endsWith('.zip')) {
    throw new ValidationError('Only ZIP files are allowed');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES.SKILL) {
    throw new ValidationError('File size must be less than 10MB');
  }

  return withAuth(async () => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.postForm<CustomSkill>('/skills/upload', formData);
    return ensureResponse(response, 'Invalid response from server');
  });
}

async function deleteSkill(skillName: string): Promise<void> {
  validateRequired(skillName, 'Skill name');

  await withAuth(async () => {
    await apiClient.delete(`/skills/${skillName}`);
  });
}

export const skillService = {
  uploadSkill,
  deleteSkill,
};
