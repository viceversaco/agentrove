import { useState, useCallback } from 'react';
import { permissionService } from '@/services/permissionService';
import { usePermissionStore } from '@/store/permissionStore';
import { useUIStore } from '@/store/uiStore';
import { addResolvedRequestId } from '@/utils/permissionStorage';

type ApiError = Error & { status?: number };

function isExpiredRequestError(error: unknown): boolean {
  return (error as ApiError)?.status === 404;
}

export function useExitPlanMode(chatId: string | undefined) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingRequests = usePermissionStore((state) => state.pendingRequests);
  const clearPermissionRequest = usePermissionStore((state) => state.clearPermissionRequest);
  const setPermissionMode = useUIStore((state) => state.setPermissionMode);

  const pendingRequest = chatId ? (pendingRequests.get(chatId) ?? null) : null;
  const isExitPlanModeRequest = pendingRequest?.tool_name === 'ExitPlanMode';

  const handleApprove = useCallback(async () => {
    if (!chatId || !pendingRequest || !isExitPlanModeRequest) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await permissionService.respondToPermission(chatId, pendingRequest.request_id, true);
      addResolvedRequestId(pendingRequest.request_id);
      clearPermissionRequest(chatId);
      setPermissionMode('auto');
    } catch (err) {
      if (isExpiredRequestError(err)) {
        addResolvedRequestId(pendingRequest.request_id);
        clearPermissionRequest(chatId);
      } else {
        setError('Failed to approve plan');
      }
    } finally {
      setIsLoading(false);
    }
  }, [chatId, pendingRequest, isExitPlanModeRequest, clearPermissionRequest, setPermissionMode]);

  const handleReject = useCallback(
    async (alternativeInstruction?: string) => {
      if (!chatId || !pendingRequest || !isExitPlanModeRequest) {
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await permissionService.respondToPermission(
          chatId,
          pendingRequest.request_id,
          false,
          alternativeInstruction,
        );
        addResolvedRequestId(pendingRequest.request_id);
        clearPermissionRequest(chatId);
      } catch (err) {
        if (isExpiredRequestError(err)) {
          addResolvedRequestId(pendingRequest.request_id);
          clearPermissionRequest(chatId);
        } else {
          setError('Failed to reject plan');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [chatId, pendingRequest, isExitPlanModeRequest, clearPermissionRequest],
  );

  return {
    pendingRequest: isExitPlanModeRequest ? pendingRequest : null,
    isLoading,
    error,
    handleApprove,
    handleReject,
  };
}
