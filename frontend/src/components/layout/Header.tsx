import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Command, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useNavigate, useMatch } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { useCurrentUserQuery, useLogoutMutation } from '@/hooks/queries/useAuthQueries';
import { Button } from '@/components/ui/primitives/Button';
import { ToggleButton } from '@/components/ui/ToggleButton';
import { cn } from '@/utils/cn';
import { UserAvatarCircle } from '@/components/chat/message-bubble/MessageAvatars';

export interface HeaderProps {
  onLogout?: () => void;
  userName?: string;
  isAuthPage?: boolean;
}

const menuItemClasses = cn(
  'w-full px-2.5 py-1.5 text-left text-xs',
  'text-text-tertiary dark:text-text-dark-tertiary',
  'hover:bg-surface-hover/60 dark:hover:bg-surface-dark-hover/60',
  'hover:text-text-primary dark:hover:text-text-dark-primary',
  'rounded-lg transition-colors duration-200',
  'flex items-center gap-2.5',
);

function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: () => void,
) {
  useEffect(() => {
    function handle(event: MouseEvent) {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    }

    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [handler, ref]);
}

const THEME_ICON_MAP = {
  dark: Sun,
  light: Moon,
  system: Monitor,
} as const;

const THEME_NEXT_LABEL = {
  dark: 'light',
  light: 'system',
  system: 'dark',
} as const;

function ThemeToggleButton({ theme, onToggle }: { theme: string; onToggle: () => void }) {
  const Icon = THEME_ICON_MAP[theme as keyof typeof THEME_ICON_MAP] ?? Monitor;
  const nextLabel = THEME_NEXT_LABEL[theme as keyof typeof THEME_NEXT_LABEL] ?? 'dark';
  return (
    <Button
      onClick={onToggle}
      variant="unstyled"
      className={cn(
        'relative rounded-full p-1.5',
        'text-text-tertiary hover:text-text-primary',
        'dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
        'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        'transition-colors duration-200',
      )}
      aria-label="Toggle theme"
      title={`Switch to ${nextLabel} mode`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

function AuthButtons({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={onLogin}
        variant="unstyled"
        className={cn(
          'rounded-lg px-3 py-1.5 text-xs font-medium',
          'text-text-secondary hover:text-text-primary',
          'dark:text-text-dark-secondary dark:hover:text-text-dark-primary',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'transition-colors duration-200',
        )}
      >
        Log in
      </Button>
      <Button
        onClick={onSignup}
        variant="unstyled"
        className={cn(
          'rounded-lg px-3 py-1.5 text-xs font-medium',
          'bg-text-primary text-surface-secondary',
          'dark:bg-text-dark-primary dark:text-surface-dark-secondary',
          'transition-colors duration-200 hover:opacity-80',
        )}
      >
        Get Started
      </Button>
    </div>
  );
}

function UserMenu({
  displayName,
  onSettings,
  onPrefetchSettings,
  onLogout,
}: {
  displayName: string;
  onSettings: () => void;
  onPrefetchSettings: () => void;
  onLogout: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setIsOpen(false), []);
  const toggleMenu = useCallback(() => setIsOpen((prev) => !prev), []);

  useClickOutside(dropdownRef, closeMenu);

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        onClick={toggleMenu}
        variant="unstyled"
        className={cn(
          'flex items-center rounded-full p-0.5',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'transition-colors duration-200',
        )}
        aria-label="User menu"
        title="Open user menu"
      >
        <UserAvatarCircle displayName={displayName} />
      </Button>

      {isOpen && (
        <div
          className={cn(
            'absolute right-0 mt-1.5 w-52',
            'bg-surface-secondary/95 dark:bg-surface-dark-secondary/95',
            'border border-border/50 dark:border-border-dark/50',
            'overflow-hidden rounded-xl shadow-medium backdrop-blur-xl',
            'animate-fadeIn',
          )}
        >
          <div className="border-b border-border/50 px-3 py-2.5 dark:border-border-dark/50">
            <div className="flex items-center gap-2.5">
              <UserAvatarCircle displayName={displayName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
                  {displayName}
                </p>
              </div>
            </div>
          </div>

          <div className="p-1">
            <Button
              onClick={() => {
                onSettings();
                closeMenu();
              }}
              onMouseEnter={onPrefetchSettings}
              onFocus={onPrefetchSettings}
              variant="unstyled"
              className={menuItemClasses}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Settings</span>
            </Button>
            <div className="my-1 border-t border-border/50 dark:border-border-dark/50" />
            <Button
              onClick={() => {
                onLogout();
                closeMenu();
              }}
              variant="unstyled"
              className={menuItemClasses}
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Header({ onLogout, userName = 'User', isAuthPage = false }: HeaderProps) {
  const navigate = useNavigate();
  const isChatPage = useMatch('/chat/:chatId');
  const isLandingPage = useMatch('/');
  const showSidebar = isChatPage || isLandingPage;
  const theme = useUIStore((state) => state.theme);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const { data: user } = useCurrentUserQuery({
    enabled: isAuthenticated && !isAuthPage,
  });

  const logoutMutation = useLogoutMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(false);
      navigate('/login');
    },
  });

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
    onLogout?.();
  }, [logoutMutation, onLogout]);

  const displayName = user?.username || user?.email || userName;

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  const prefetchSettingsPage = useCallback(() => {
    void import('@/pages/SettingsPage');
  }, []);

  const showStandaloneThemeToggle = isAuthPage || !isAuthenticated;

  return (
    <header className="z-50 border-b border-border/50 bg-surface px-4 dark:border-border-dark/50 dark:bg-surface-dark">
      <div className="relative flex h-10 items-center justify-between">
        <div className="flex items-center gap-1">
          {isAuthPage && (
            <Button
              onClick={() => navigate('/')}
              variant="unstyled"
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs',
                'text-text-tertiary hover:text-text-primary',
                'dark:text-text-dark-tertiary dark:hover:text-text-dark-primary',
                'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                'transition-colors duration-200',
              )}
              aria-label="Back to home"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Home</span>
            </Button>
          )}
          {isAuthenticated && showSidebar && (
            <>
              <ToggleButton
                isOpen={sidebarOpen}
                onClick={() => useUIStore.getState().setSidebarOpen(!sidebarOpen)}
                position="left"
                className="mr-1"
                ariaLabel="Toggle sidebar"
              />
              {isChatPage && (
                <Button
                  onClick={() => useUIStore.getState().setCommandMenuOpen(true)}
                  variant="unstyled"
                  className={cn(
                    'rounded-full p-1.5',
                    'text-text-tertiary hover:text-text-primary',
                    'dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
                    'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                    'transition-colors duration-200',
                  )}
                  aria-label="Open command menu"
                >
                  <Command className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {showStandaloneThemeToggle && (
            <ThemeToggleButton theme={theme} onToggle={() => useUIStore.getState().toggleTheme()} />
          )}
          {isAuthPage ? null : isAuthenticated ? (
            <UserMenu
              displayName={displayName}
              onSettings={() => {
                prefetchSettingsPage();
                handleNavigate('/settings');
              }}
              onPrefetchSettings={prefetchSettingsPage}
              onLogout={handleLogout}
            />
          ) : (
            <AuthButtons
              onLogin={() => handleNavigate('/login')}
              onSignup={() => handleNavigate('/signup')}
            />
          )}
        </div>
      </div>
    </header>
  );
}
