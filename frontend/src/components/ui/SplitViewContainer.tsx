import { memo, useEffect, ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { ViewType } from '@/types/ui.types';

interface SplitViewContainerProps {
  renderView: (view: ViewType, slot: 'single' | 'primary' | 'secondary') => ReactNode;
}

export const SplitViewContainer = memo(function SplitViewContainer({
  renderView,
}: SplitViewContainerProps) {
  const currentView = useUIStore((state) => state.currentView);
  const secondaryView = useUIStore((state) => state.secondaryView);
  const isSplitMode = useUIStore((state) => state.isSplitMode);
  const exitSplitMode = useUIStore((state) => state.exitSplitMode);
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useUIStore.getState().isSplitMode) {
        exitSplitMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exitSplitMode]);

  if (isMobile || !isSplitMode || !secondaryView) {
    return (
      <div className="flex h-full flex-1 overflow-hidden">{renderView(currentView, 'single')}</div>
    );
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId="split-view-layout" className="flex-1">
      <Panel defaultSize={50} minSize={20}>
        <div className="flex h-full w-full flex-1 overflow-hidden">
          {renderView(currentView, 'primary')}
        </div>
      </Panel>

      <PanelResizeHandle
        className={cn(
          'group relative w-px',
          'bg-border dark:bg-border-dark',
          'hover:bg-text-primary dark:hover:bg-text-dark-primary',
          'transition-colors duration-150',
        )}
      >
        <div className={cn('absolute inset-y-0 -left-2 -right-2', 'cursor-col-resize')} />
      </PanelResizeHandle>

      <Panel minSize={20}>
        <div className="flex h-full w-full flex-1 overflow-hidden">
          {renderView(secondaryView, 'secondary')}
        </div>
      </Panel>
    </PanelGroup>
  );
});
