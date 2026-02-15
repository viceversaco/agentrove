import { ReactNode, useCallback, useMemo, useState } from 'react';
import { Header, type HeaderProps } from './Header';
import { cn } from '@/utils/cn';
import { LayoutContext, type LayoutContextValue } from './layoutState';
import { useUIStore } from '@/store/uiStore';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/useIsMobile';

function MobileSidebarOverlay() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);

  if (!sidebarOpen) return null;

  return (
    <div
      className="fixed inset-0 z-30 bg-black/50 md:hidden"
      onClick={() => setSidebarOpen(false)}
      aria-hidden="true"
    />
  );
}

export interface LayoutProps extends HeaderProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  showHeader?: boolean;
}

export function Layout({
  children,
  onLogout,
  userName = 'User',
  isAuthPage = false,
  className,
  contentClassName,
  showHeader = true,
}: LayoutProps) {
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const isMobile = useIsMobile();
  const shouldPushContent = !!sidebarContent && sidebarOpen && !isMobile;

  useSwipeGesture({
    onSwipeRight: () => setSidebarOpen(true),
    onSwipeLeft: () => sidebarOpen && setSidebarOpen(false),
    enabled: isMobile && !!sidebarContent,
  });

  const setSidebar = useCallback((content: ReactNode | null) => {
    setSidebarContent(content);
  }, []);

  const contextValue = useMemo<LayoutContextValue>(
    () => ({
      sidebar: sidebarContent,
      setSidebar,
    }),
    [setSidebar, sidebarContent],
  );

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className={cn('h-viewport flex flex-col', className)}>
        {showHeader && <Header onLogout={onLogout} userName={userName} isAuthPage={isAuthPage} />}

        <div className="flex min-h-0 flex-1">
          {sidebarContent && <MobileSidebarOverlay />}

          {sidebarContent ? (
            <div className="relative h-full flex-shrink-0">{sidebarContent}</div>
          ) : null}

          <main
            className={cn(
              'relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface transition-[padding] duration-500 ease-in-out dark:bg-surface-dark',
              shouldPushContent ? 'pl-64' : 'pl-0',
              contentClassName,
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
