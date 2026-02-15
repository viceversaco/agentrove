import { logger } from '@/utils/logger';

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    logger.error('LocalStorage access failed', 'storage.getStorage', error);
    return null;
  }
};

export const safeGetItem = (key: string): string | null => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return null;
  }

  try {
    return storageInstance.getItem(key);
  } catch (error) {
    logger.error('LocalStorage get failed', 'storage.safeGetItem', error);
    return null;
  }
};

export const safeSetItem = (key: string, value: string): void => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return;
  }

  try {
    storageInstance.setItem(key, value);
  } catch (error) {
    logger.error('LocalStorage set failed', 'storage.safeSetItem', error);
  }
};

const safeRemoveItem = (key: string): void => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return;
  }

  try {
    storageInstance.removeItem(key);
  } catch (error) {
    logger.error('LocalStorage remove failed', 'storage.safeRemoveItem', error);
  }
};

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokenCacheInitialized = false;

function initTokenCache(): void {
  if (tokenCacheInitialized) return;
  cachedToken = safeGetItem('auth_token');
  cachedRefreshToken = safeGetItem('refresh_token');
  tokenCacheInitialized = true;
}

export const authStorage = {
  getToken: (): string | null => {
    initTokenCache();
    return cachedToken;
  },
  setToken: (token: string): void => {
    cachedToken = token;
    safeSetItem('auth_token', token);
  },
  getRefreshToken: (): string | null => {
    initTokenCache();
    return cachedRefreshToken;
  },
  setRefreshToken: (token: string): void => {
    cachedRefreshToken = token;
    safeSetItem('refresh_token', token);
  },
  removeRefreshToken: (): void => {
    cachedRefreshToken = null;
    safeRemoveItem('refresh_token');
  },
  clearAuth: (): void => {
    cachedToken = null;
    cachedRefreshToken = null;
    safeRemoveItem('auth_token');
    safeRemoveItem('refresh_token');
  },
};

export const chatStorage = {
  getEventId: (chatId: string): string | null => safeGetItem(`chat:${chatId}:lastEventId`),
  setEventId: (chatId: string, eventId: string): void =>
    safeSetItem(`chat:${chatId}:lastEventId`, eventId),
  removeEventId: (chatId: string): void => safeRemoveItem(`chat:${chatId}:lastEventId`),
};
