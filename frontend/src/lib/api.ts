import { authStorage } from '@/utils/storage';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions extends RequestInit {
  data?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

class RefreshTokenError extends Error {
  status: number;

  constructor(status: number, message = 'Token refresh failed') {
    super(message);
    this.name = 'RefreshTokenError';
    this.status = status;
  }
}

export type { ApiStreamResponse as StreamResponse } from '@/types/stream.types';

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const resolveHttpBaseUrl = (rawUrl: string): string =>
  trimTrailingSlash(new URL(rawUrl, window.location.origin).toString());

const resolveWsBaseUrl = (rawUrl: string): string => {
  const normalized = new URL(rawUrl, window.location.origin);
  normalized.protocol = ['https:', 'wss:'].includes(normalized.protocol) ? 'wss:' : 'ws:';
  return trimTrailingSlash(normalized.toString());
};

const getAuthHeaders = (includeContentType = true): Record<string, string> => {
  const token = authStorage.getToken();
  return {
    ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

let refreshingPromise: Promise<TokenResponse> | null = null;

async function performTokenRefresh(baseURL: string): Promise<TokenResponse> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) {
    throw new RefreshTokenError(401, 'No refresh token available');
  }

  const response = await fetch(`${baseURL}/auth/jwt/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new RefreshTokenError(response.status);
  }

  const data: TokenResponse = await response.json();
  authStorage.setToken(data.access_token);
  authStorage.setRefreshToken(data.refresh_token);
  return data;
}

async function refreshTokenIfNeeded(baseURL: string): Promise<TokenResponse> {
  if (refreshingPromise) {
    return refreshingPromise;
  }

  refreshingPromise = performTokenRefresh(baseURL);

  try {
    const result = await refreshingPromise;
    return result;
  } finally {
    refreshingPromise = null;
  }
}

function shouldInvalidateSession(error: unknown): boolean {
  if (!(error instanceof RefreshTokenError)) {
    return false;
  }
  return error.status === 401 || error.status === 403;
}

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) {
      return `HTTP error! status: ${response.status}`;
    }
    const error = JSON.parse(text);
    return error.message || error.detail || response.statusText;
  } catch {
    return response.statusText || 'An error occurred';
  }
};

class APIClient {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  getBaseUrl(): string {
    return this.baseURL;
  }

  private async handleResponse<T>(response: Response): Promise<T | null> {
    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      const error = new Error(errorMessage) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private async request<T>(
    endpoint: string,
    method: RequestMethod = 'GET',
    options: RequestOptions = {},
    additionalHeaders: Record<string, string> = {},
    isRetry = false,
  ): Promise<T | null> {
    const { data, formData, signal, ...customConfig } = options;

    const config: RequestInit = {
      method,
      headers: {
        ...getAuthHeaders(!formData),
        ...additionalHeaders,
      },
      signal,
      ...customConfig,
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    if (formData) {
      config.body = formData;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, config);

    if (response.status === 401 && !isRetry && !endpoint.includes('/auth/jwt/')) {
      const hasRefreshToken = !!authStorage.getRefreshToken();
      if (hasRefreshToken) {
        try {
          await refreshTokenIfNeeded(this.baseURL);
          return this.request<T>(endpoint, method, options, additionalHeaders, true);
        } catch (error) {
          if (shouldInvalidateSession(error)) {
            authStorage.clearAuth();
            window.location.href = '/login';
            throw new Error('Session expired');
          }
          throw error;
        }
      }
    }

    return this.handleResponse(response);
  }

  async get<T>(endpoint: string, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'GET', { signal });
  }

  async post<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'POST', { data, signal });
  }

  async patch<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'PATCH', { data, signal });
  }

  async put<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'PUT', { data, signal });
  }

  async postForm<T>(endpoint: string, formData: FormData, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'POST', { formData, signal });
  }

  async delete(endpoint: string, signal?: AbortSignal) {
    return this.request(endpoint, 'DELETE', { signal });
  }

  async getBlob(endpoint: string, signal?: AbortSignal, isRetry = false): Promise<Blob> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'GET',
      headers: getAuthHeaders(false),
      signal,
    });

    if (response.status === 401 && !isRetry) {
      const hasRefreshToken = !!authStorage.getRefreshToken();
      if (hasRefreshToken) {
        try {
          await refreshTokenIfNeeded(this.baseURL);
          return this.getBlob(endpoint, signal, true);
        } catch (error) {
          if (shouldInvalidateSession(error)) {
            authStorage.clearAuth();
            window.location.href = '/login';
            throw new Error('Session expired');
          }
          throw error;
        }
      }
    }

    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      throw new Error(errorMessage);
    }

    return response.blob();
  }
}

export const API_BASE_URL: string = resolveHttpBaseUrl(import.meta.env.VITE_API_BASE_URL);
export const WS_BASE_URL: string = resolveWsBaseUrl(import.meta.env.VITE_WS_URL);
export const API_ORIGIN: string = new URL(API_BASE_URL).origin;

export const apiClient = new APIClient(API_BASE_URL);
