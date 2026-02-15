import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsService, type GmailStatus } from '@/services/integrationsService';
import { API_ORIGIN } from '@/lib/api';
import toast from 'react-hot-toast';

const GMAIL_STATUS_KEY = ['integrations', 'gmail', 'status'] as const;

export const useGmailIntegration = () => {
  const queryClient = useQueryClient();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const { data: status, isLoading } = useQuery<GmailStatus>({
    queryKey: GMAIL_STATUS_KEY,
    queryFn: integrationsService.getGmailStatus,
  });

  const uploadMutation = useMutation({
    mutationFn: integrationsService.uploadGmailOAuthClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GMAIL_STATUS_KEY });
      toast.success('OAuth client uploaded');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to upload OAuth client');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: integrationsService.deleteGmailOAuthClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GMAIL_STATUS_KEY });
      toast.success('OAuth client removed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove OAuth client');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: integrationsService.disconnectGmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GMAIL_STATUS_KEY });
      toast.success('Gmail disconnected');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to disconnect Gmail');
    },
  });

  const connectGmail = useCallback(async () => {
    try {
      const url = await integrationsService.getGmailOAuthUrl();
      const popup = window.open(url, 'gmail-oauth', 'width=500,height=600,scrollbars=yes');
      if (!popup) {
        toast.error('Pop-up blocked. Please allow pop-ups to connect Gmail.');
        return;
      }

      const expectedOrigin = API_ORIGIN;

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) return;
        if (event.data === 'gmail-connected') {
          queryClient.invalidateQueries({ queryKey: GMAIL_STATUS_KEY });
          toast.success('Gmail connected');
          window.removeEventListener('message', handleMessage);
        }
      };

      window.addEventListener('message', handleMessage);

      const pollInterval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollInterval);
          window.removeEventListener('message', handleMessage);
          cleanupRef.current = null;
          queryClient.invalidateQueries({ queryKey: GMAIL_STATUS_KEY });
        }
      }, 1000);

      cleanupRef.current = () => {
        clearInterval(pollInterval);
        window.removeEventListener('message', handleMessage);
      };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start OAuth flow');
    }
  }, [queryClient]);

  return {
    status: status ?? {
      connected: false,
      email: null,
      connected_at: null,
      has_oauth_client: false,
    },
    isLoading,
    uploadOAuthClient: uploadMutation.mutate,
    isUploading: uploadMutation.isPending,
    deleteOAuthClient: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    connectGmail,
    disconnectGmail: disconnectMutation.mutate,
    isDisconnecting: disconnectMutation.isPending,
  };
};
