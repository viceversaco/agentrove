import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { Layout } from '@/components/layout/Layout';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useGlobalStream, useStreamRestoration } from '@/hooks/useChatStreaming';
import { authService } from '@/services/authService';
import { toasterConfig } from '@/config/toaster';
import { AuthRoute } from '@/components/routes/AuthRoute';
import { API_BASE_URL } from '@/lib/api';
import { isTauri } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { authStorage } from '@/utils/storage';

const LandingPage = lazy(() =>
  import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() =>
  import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const EmailVerificationPage = lazy(() =>
  import('@/pages/EmailVerificationPage').then((m) => ({ default: m.EmailVerificationPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

async function checkDesktopUpdate(): Promise<void> {
  const update = await check();
  if (!update?.available) {
    return;
  }

  const shouldInstall = window.confirm(`Claudex ${update.version} is available. Install now?`);
  if (!shouldInstall) {
    return;
  }

  toast.loading('Downloading desktop update...', { id: 'desktop-update' });
  await update.downloadAndInstall();
  toast.success(`Claudex ${update.version} installed. Restart app to finish update.`, {
    id: 'desktop-update',
  });
}

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasToken = !!authService.getToken();
  const isSessionAuthenticated = isAuthenticated && hasToken;
  const { data: user, isLoading } = useCurrentUserQuery({
    enabled: hasToken,
    retry: false,
  });

  // NOTE: This effect intentionally syncs auth state via useEffect rather than deriving during
  // render (rerender-derived-state-no-effect). The persisted Zustand store provides an optimistic
  // cached isAuthenticated on first load to prevent flash of unauthenticated content, then this
  // effect corrects it after the user query resolves. Moving to render-time derivation would
  // require calling an external store setter during render, which re-triggers subscribers
  // synchronously and risks cascading updates.
  useEffect(() => {
    if (hasToken && user) {
      useAuthStore.getState().setAuthenticated(true);
    } else if (isAuthenticated && !hasToken) {
      useAuthStore.getState().setAuthenticated(false);
    }
  }, [user, hasToken, isAuthenticated]);

  const { data: chatsData, isLoading: isChatsLoading } = useInfiniteChatsQuery({
    enabled: isSessionAuthenticated,
  });

  const allChats = useMemo(
    () => chatsData?.pages.flatMap((page) => page.items) ?? [],
    [chatsData?.pages],
  );

  useStreamRestoration({
    chats: allChats,
    isLoading: isChatsLoading,
    enabled: isSessionAuthenticated,
  });

  const showLoading = hasToken && isLoading;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <LoginPage />
            </AuthRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <SignupPage />
            </AuthRoute>
          }
        />
        <Route path="/verify-email" element={<EmailVerificationPage />} />
        <Route
          path="/forgot-password"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <ForgotPasswordPage />
            </AuthRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <ResetPasswordPage />
            </AuthRoute>
          }
        />
        <Route
          path="/"
          element={
            showLoading ? (
              <LoadingScreen />
            ) : (
              <Layout>
                <LandingPage />
              </Layout>
            )
          }
        />
        <Route
          path="/chat/:chatId"
          element={
            <AuthRoute
              isAuthenticated={isSessionAuthenticated}
              requireAuth={true}
              showLoading={showLoading}
            >
              <ChatPage />
            </AuthRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthRoute
              isAuthenticated={isSessionAuthenticated}
              requireAuth={true}
              showLoading={showLoading}
            >
              <SettingsPage />
            </AuthRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const resolvedTheme = useResolvedTheme();
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);

  useGlobalStream({ enabled: authHydrated });

  useEffect(() => {
    let cancelled = false;

    authStorage
      .hydrate()
      .catch((error) => {
        console.error('Auth storage hydration failed:', error);
      })
      .finally(() => {
        if (cancelled) return;
        useAuthStore.getState().setAuthenticated(!!authStorage.getToken());
        setAuthHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(resolvedTheme);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff');
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isTauri()) return;

    let interval: number | undefined;
    let cancelled = false;
    const apiUrl = new URL(API_BASE_URL, window.location.origin);
    const healthUrl = `${apiUrl.origin}/api/v1/readyz`;

    const check = async () => {
      try {
        const response = await fetch(healthUrl, { method: 'GET', cache: 'no-store' });
        if (!cancelled) {
          setBackendReady(response.ok);
          if (response.ok && interval) {
            window.clearInterval(interval);
            interval = undefined;
          }
        }
      } catch {
        if (!cancelled) setBackendReady(false);
      }
    };

    check();
    interval = window.setInterval(check, 3000);

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV || !isTauri()) return;

    checkDesktopUpdate().catch((error) => {
      console.error('Desktop updater check failed:', error);
    });
  }, []);

  if (!authHydrated) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      {backendReady === false && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-2 bg-surface-tertiary px-4 py-2 text-center text-xs font-medium text-text-primary dark:bg-surface-dark-tertiary dark:text-text-dark-primary">
          <svg
            className="h-3 w-3 animate-spin text-text-quaternary dark:text-text-dark-quaternary"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Starting backend...
        </div>
      )}
      <Toaster {...toasterConfig} />
      <AppContent />
    </BrowserRouter>
  );
}
