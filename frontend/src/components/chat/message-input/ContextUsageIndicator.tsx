export interface ContextUsageInfo {
  tokensUsed: number;
  contextWindow: number;
}

const formatNumberCompact = (num: number): string => {
  if (num < 1000) return num.toString();
  if (num < 1000000) return Math.round(num / 1000) + 'k';
  return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
};

export const ContextUsageIndicator = ({ usage }: { usage: ContextUsageInfo }) => {
  const percentage =
    usage.contextWindow > 0 ? Math.min((usage.tokensUsed / usage.contextWindow) * 100, 100) : 0;

  const formattedPercentage =
    percentage === 0
      ? '0'
      : percentage >= 10
        ? percentage.toFixed(0)
        : percentage >= 1
          ? percentage.toFixed(1)
          : percentage.toFixed(2);

  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percentage / 100);

  const progressClass =
    percentage >= 95
      ? 'text-error-500 dark:text-error-400'
      : percentage >= 75
        ? 'text-warning-500 dark:text-warning-400'
        : 'text-text-primary dark:text-text-dark-primary';

  const tooltip = `${formatNumberCompact(usage.tokensUsed)}/${formatNumberCompact(usage.contextWindow)}`;

  return (
    <div
      className="flex select-none items-center gap-1.5 text-xs text-text-secondary dark:text-text-dark-secondary"
      title={tooltip}
    >
      <span className="font-medium tabular-nums">{formattedPercentage}%</span>
      <svg viewBox="0 0 24 24" className="h-6 w-6" role="presentation" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={radius}
          strokeWidth="2"
          stroke="currentColor"
          className="text-border dark:text-border-dark"
          fill="none"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          strokeWidth="2"
          stroke="currentColor"
          className={progressClass}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
    </div>
  );
};
