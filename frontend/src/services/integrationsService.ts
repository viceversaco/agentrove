import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';

export interface GmailStatus {
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  has_oauth_client: boolean;
}

interface OAuthClientResponse {
  success: boolean;
  message: string;
}

interface OAuthUrlResponse {
  url: string;
}

async function uploadGmailOAuthClient(clientConfig: object): Promise<OAuthClientResponse> {
  return withAuth(async () => {
    const response = await apiClient.post<OAuthClientResponse>('/integrations/gmail/oauth-client', {
      client_config: clientConfig,
    });
    return ensureResponse(response, 'Failed to upload OAuth client');
  });
}

async function deleteGmailOAuthClient(): Promise<OAuthClientResponse> {
  return withAuth(async () => {
    const response = await apiClient.delete<OAuthClientResponse>(
      '/integrations/gmail/oauth-client',
    );
    return ensureResponse(response, 'Failed to delete OAuth client');
  });
}

async function getGmailOAuthUrl(): Promise<string> {
  return withAuth(async () => {
    const response = await apiClient.get<OAuthUrlResponse>('/integrations/gmail/oauth-url');
    const data = ensureResponse(response, 'Failed to get OAuth URL');
    return data.url;
  });
}

async function getGmailStatus(): Promise<GmailStatus> {
  return withAuth(async () => {
    const response = await apiClient.get<GmailStatus>('/integrations/gmail/status');
    return ensureResponse(response, 'Failed to get Gmail status');
  });
}

async function disconnectGmail(): Promise<OAuthClientResponse> {
  return withAuth(async () => {
    const response = await apiClient.post<OAuthClientResponse>('/integrations/gmail/disconnect');
    return ensureResponse(response, 'Failed to disconnect Gmail');
  });
}

export const integrationsService = {
  uploadGmailOAuthClient,
  deleteGmailOAuthClient,
  getGmailOAuthUrl,
  getGmailStatus,
  disconnectGmail,
};
