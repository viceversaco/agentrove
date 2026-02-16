import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ThemeState,
  PermissionModeState,
  ThinkingModeState,
  UIState,
  UIActions,
  SplitViewState,
  SplitViewActions,
} from '@/types/ui.types';
import { MOBILE_BREAKPOINT } from '@/config/constants';

type UIStoreState = ThemeState &
  PermissionModeState &
  ThinkingModeState &
  Pick<UIState, 'sidebarOpen'> &
  Pick<UIActions, 'setSidebarOpen'> &
  SplitViewState &
  SplitViewActions & {
    commandMenuOpen: boolean;
    setCommandMenuOpen: (open: boolean) => void;
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
        set((state) => ({
          theme: state.theme === 'dark' ? 'light' : 'dark',
        })),
      permissionMode: 'auto',
      setPermissionMode: (mode) => set({ permissionMode: mode }),
      thinkingMode: null,
      setThinkingMode: (mode) => set({ thinkingMode: mode }),
      sidebarOpen: getInitialSidebarState(),
      setSidebarOpen: (isOpen) => set({ sidebarOpen: isOpen }),

      commandMenuOpen: false,
      setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),

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
      version: 1,
      partialize: (state) => ({
        theme: state.theme,
        permissionMode: state.permissionMode,
        thinkingMode: state.thinkingMode,
        currentView: state.currentView,
        secondaryView: state.secondaryView,
        isSplitMode: state.isSplitMode,
        splitDirection: state.splitDirection,
        sidebarOpen: state.sidebarOpen,
      }),
      migrate: (persisted) => persisted as Record<string, unknown>,
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
      }),
    },
  ),
);
