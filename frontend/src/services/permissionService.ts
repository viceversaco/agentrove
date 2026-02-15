import { apiClient } from '@/lib/api';
import { serviceCall } from '@/services/base/BaseService';
import { validateId } from '@/utils/validation';

async function respondToPermission(
  chatId: string,
  requestId: string,
  approved: boolean,
  alternativeInstruction?: string,
): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(requestId, 'Request ID');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('approved', approved.toString());
    if (alternativeInstruction) {
      formData.append('alternative_instruction', alternativeInstruction);
    }

    await apiClient.postForm(`/chat/chats/${chatId}/permissions/${requestId}/respond`, formData);
  });
}

async function respondWithAnswers(
  chatId: string,
  requestId: string,
  answers: Record<string, string | string[]>,
): Promise<void> {
  validateId(chatId, 'Chat ID');
  validateId(requestId, 'Request ID');

  return serviceCall(async () => {
    const formData = new FormData();
    formData.append('approved', 'true');
    formData.append('user_answers', JSON.stringify(answers));

    await apiClient.postForm(`/chat/chats/${chatId}/permissions/${requestId}/respond`, formData);
  });
}

export const permissionService = {
  respondToPermission,
  respondWithAnswers,
};
