import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ThemeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
} from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';

type UIStoreState = ThemeState &
  Pick<UIState, 'sidebarOpen'> &
  Pick<UIActions, 'setSidebarOpen'> &
  SplitViewState &
  SplitViewActions & {
    commandMenuOpen: boolean;
    setCommandMenuOpen: (open: boolean) => void;
    pendingFilePath: string | null;
    openFileInEditor: (path: string) => void;
  };

const getInitialSidebarState = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth >= MOBILE_BREAKPOINT;
};

export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () =>
        set((state) => {
          const next =
            state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'system' : 'dark';
          return { theme: next };
        }),
      setTheme: (theme) => set({ theme }),
      sidebarOpen: getInitialSidebarState(),
      setSidebarOpen: (isOpen) => set({ sidebarOpen: isOpen }),

      commandMenuOpen: false,
      setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),

      pendingFilePath: null,
      openFileInEditor: (path) => {
        const isMobile = typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;
        set(
          isMobile
            ? {
                currentView: 'editor',
                isSplitMode: false,
                secondaryView: null,
                pendingFilePath: path,
              }
            : { secondaryView: 'editor', isSplitMode: true, pendingFilePath: path },
        );
      },

      isSplitMode: false,
      currentView: 'agent',
      secondaryView: null,
      splitDirection: 'horizontal',

      setCurrentView: (view) => set({ currentView: view, isSplitMode: false, secondaryView: null }),

      setSecondaryView: (view) => set({ secondaryView: view, isSplitMode: view !== null }),

      exitSplitMode: () => set({ isSplitMode: false, secondaryView: null }),

      setSplitDirection: (direction) => set({ splitDirection: direction }),

      handleViewClick: (view, isShiftClick) => {
        const state = get();
        if (
          isShiftClick &&
          typeof window !== 'undefined' &&
          window.innerWidth >= MOBILE_BREAKPOINT
        ) {
          if (state.currentView === view) {
            return;
          }
          set({
            secondaryView: view,
            isSplitMode: true,
          });
        } else {
          set({
            currentView: view,
            isSplitMode: false,
            secondaryView: null,
          });
        }
      },
    }),
    {
      name: 'ui-storage',
      version: 3,
      partialize: (state) => ({
        theme: state.theme,
        currentView: state.currentView,
        splitDirection: state.splitDirection,
        sidebarOpen: state.sidebarOpen,
      }),
      migrate: (persisted) => {
        const state = persisted as Record<string, unknown>;
        delete state.isSplitMode;
        delete state.secondaryView;
        delete state.permissionMode;
        delete state.thinkingMode;
        return state;
      },
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
      }),
    },
  ),
);
