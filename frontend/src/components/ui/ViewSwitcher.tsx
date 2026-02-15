import {
  MessagesSquare,
  Code,
  SquareTerminal,
  KeyRound,
  Globe,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import type { ViewType } from '@/types/ui.types';
import { LAYOUT_CLASSES } from '@/config/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Tooltip } from './Tooltip';

function VSCodeIcon({ className }: { className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M23.15 2.587L18.21.21a1.49 1.49 0 0 0-1.705.29l-9.46 8.63l-4.12-3.128a1 1 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12L.326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a1 1 0 0 0 1.276.057l4.12-3.128l9.46 8.63a1.49 1.49 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352m-5.146 14.861L10.826 12l7.178-5.448z" />
    </svg>
  );
}

interface ActivityBarButton {
  view: ViewType;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  hideOnMobile?: boolean;
}

const buttons: ActivityBarButton[] = [
  { view: 'agent', icon: MessagesSquare, label: 'Agent' },
  { view: 'ide', icon: VSCodeIcon, label: 'IDE', hideOnMobile: true },
  { view: 'editor', icon: Code, label: 'Editor' },
  { view: 'terminal', icon: SquareTerminal, label: 'Terminal' },
  { view: 'secrets', icon: KeyRound, label: 'Secrets' },
  { view: 'webPreview', icon: Globe, label: 'Web Preview' },
  { view: 'mobilePreview', icon: Smartphone, label: 'Mobile Preview' },
  { view: 'browser', icon: Monitor, label: 'Browser' },
];

export function ActivityBar() {
  const currentView = useUIStore((state) => state.currentView);
  const secondaryView = useUIStore((state) => state.secondaryView);
  const isSplitMode = useUIStore((state) => state.isSplitMode);
  const handleViewClick = useUIStore((state) => state.handleViewClick);
  const isMobile = useIsMobile();

  const visibleButtons = buttons.filter((btn) => !isMobile || !btn.hideOnMobile);

  const getButtonState = (view: ViewType): 'primary' | 'secondary' | 'none' => {
    if (view === currentView) return 'primary';
    if (isSplitMode && view === secondaryView) return 'secondary';
    return 'none';
  };

  const handleClick = (view: ViewType, event: React.MouseEvent) => {
    handleViewClick(view, event.shiftKey);
  };

  const getTooltipContent = (label: string) => {
    if (isMobile) return label;
    return `${label} (Shift+click for split view)`;
  };

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 top-12 z-50 flex flex-col items-center gap-1 bg-surface py-2 dark:bg-surface-dark',
        LAYOUT_CLASSES.ACTIVITY_BAR_WIDTH,
      )}
    >
      {visibleButtons.map(({ view, icon: Icon, label }) => {
        const buttonState = getButtonState(view);
        const isPrimary = buttonState === 'primary';
        const isSecondary = buttonState === 'secondary';

        return (
          <Tooltip key={view} content={getTooltipContent(label)} position="right">
            <button
              onClick={(e) => handleClick(view, e)}
              className={cn(
                'relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-200',
                isPrimary
                  ? 'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
                  : isSecondary
                    ? 'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
                    : 'text-text-quaternary hover:bg-surface-hover hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-secondary',
              )}
              aria-label={`Switch to ${label.toLowerCase()} view`}
              aria-pressed={isPrimary || isSecondary}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { ActivityBar as ViewSwitcher };
