import { memo } from 'react';
import { User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { cn } from '@/utils/cn';
import iconDark from '/assets/images/icon-dark.svg';
import iconLight from '/assets/images/icon-white.svg';

export const UserAvatarCircle = memo(
  ({ displayName, size = 'default' }: { displayName: string; size?: 'default' | 'large' }) => {
    const sizeClasses = size === 'large' ? 'w-7 h-7' : 'w-5 h-5';
    const iconSize = size === 'large' ? 'w-3.5 h-3.5' : 'w-3 h-3';

    return (
      <div
        className={cn(
          sizeClasses,
          'rounded-full bg-surface-active dark:bg-surface-dark-hover',
          'flex items-center justify-center text-2xs font-medium text-text-secondary dark:text-text-dark-secondary',
          'transition-all duration-200',
        )}
      >
        {displayName?.[0]?.toUpperCase() || <User className={iconSize} />}
      </div>
    );
  },
);

UserAvatarCircle.displayName = 'UserAvatarCircle';

export const UserAvatar = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  useCurrentUserQuery({
    enabled: isAuthenticated,
  });

  return (
    <div className="flex h-6 w-6 items-center justify-center">
      <User className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
    </div>
  );
};

export const BotAvatar = () => (
  <div className="flex h-6 w-6 items-center justify-center">
    <img src={iconDark} alt="Claudex" className="h-3 w-3 dark:hidden" />
    <img src={iconLight} alt="Claudex" className="hidden h-3 w-3 dark:block" />
  </div>
);
