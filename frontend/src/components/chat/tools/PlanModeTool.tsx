import { memo, useState, useCallback } from 'react';
import { Map, CheckCircle, XCircle, AlertCircle, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import type { ToolAggregate } from '@/types/tools.types';
import { ToolCard } from './common/ToolCard';
import { useExitPlanMode } from '@/hooks/useExitPlanMode';

interface PlanModeToolProps {
  tool: ToolAggregate;
  chatId?: string;
}

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

const EnterPlanModeInner: React.FC<PlanModeToolProps> = ({ tool }) => (
  <ToolCard
    icon={<Map className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
    status={tool.status}
    title={(status) => {
      switch (status) {
        case 'completed':
          return 'Entered plan mode';
        case 'failed':
          return 'Failed to enter plan mode';
        default:
          return 'Entering plan mode';
      }
    }}
    loadingContent="Entering plan mode..."
    error={tool.error}
  />
);

const ExitPlanModeInner: React.FC<PlanModeToolProps> = ({ tool, chatId }) => {
  const { pendingRequest, isLoading, error, handleApprove, handleReject } = useExitPlanMode(chatId);

  const [showRejectInput, setShowRejectInput] = useState(false);
  const [alternativeInstruction, setAlternativeInstruction] = useState('');

  const planContent = tool.input?.plan as string | undefined;
  const allowedPrompts = (tool.input?.allowedPrompts ?? []) as AllowedPrompt[];

  const handleRejectClick = useCallback(() => {
    if (showRejectInput && alternativeInstruction.trim()) {
      handleReject(alternativeInstruction.trim());
      setAlternativeInstruction('');
      setShowRejectInput(false);
    } else {
      setShowRejectInput(true);
    }
  }, [showRejectInput, alternativeInstruction, handleReject]);

  const handleJustReject = useCallback(() => {
    handleReject();
    setShowRejectInput(false);
    setAlternativeInstruction('');
  }, [handleReject]);

  if (pendingRequest) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface-tertiary dark:border-border-dark dark:bg-surface-dark-tertiary">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 dark:border-border-dark">
          <div className="flex items-center gap-2">
            <div className="rounded-md bg-black/5 p-1 dark:bg-white/5">
              <Map className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
            </div>
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Plan Approval
            </span>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-3">
          <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
            The assistant has finished planning and is ready to begin implementation.
          </p>

          {planContent && (
            <div className="mt-3 overflow-auto rounded-md bg-black/5 px-2 py-1.5 text-xs dark:bg-white/5">
              <div className="prose prose-sm dark:prose-invert max-w-none text-text-primary dark:text-text-dark-primary">
                <LazyMarkDown content={planContent} />
              </div>
            </div>
          )}

          {allowedPrompts.length > 0 && (
            <div className="mt-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-text-tertiary dark:text-text-dark-tertiary">
                Requested Permissions
              </p>
              <div className="mt-1.5 space-y-1">
                {allowedPrompts.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 dark:bg-white/5"
                  >
                    <Terminal className="h-3 w-3 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
                    <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                      {item.prompt}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showRejectInput && (
            <div className="mt-3">
              <label className="text-2xs font-medium uppercase tracking-wide text-text-tertiary dark:text-text-dark-tertiary">
                Alternative Instructions
              </label>
              <textarea
                value={alternativeInstruction}
                onChange={(e) => setAlternativeInstruction(e.target.value)}
                placeholder="Tell the assistant what to do instead..."
                className="mt-1.5 w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-primary placeholder-text-quaternary transition-colors focus:border-text-quaternary focus:outline-none focus:ring-1 focus:ring-text-quaternary/30 dark:border-border-dark dark:bg-surface-dark dark:text-text-dark-primary dark:placeholder-text-dark-tertiary"
                rows={2}
                disabled={isLoading}
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-2 dark:border-border-dark">
          <div>
            {error && (
              <div className="flex items-center gap-2 text-2xs text-error-600 dark:text-error-400">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showRejectInput ? (
              <>
                <Button onClick={handleJustReject} variant="ghost" size="sm" disabled={isLoading}>
                  <XCircle className="h-3.5 w-3.5" />
                  Just Reject
                </Button>
                <Button
                  onClick={handleRejectClick}
                  variant="primary"
                  size="sm"
                  disabled={isLoading || !alternativeInstruction.trim()}
                >
                  Send
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleRejectClick} variant="ghost" size="sm" disabled={isLoading}>
                  Reject
                </Button>
                <Button onClick={handleApprove} variant="primary" size="sm" disabled={isLoading}>
                  <CheckCircle className="h-3.5 w-3.5" />
                  Approve
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToolCard
      icon={<Map className="h-3.5 w-3.5 text-text-secondary dark:text-text-dark-tertiary" />}
      status={tool.status}
      title={(status) => {
        switch (status) {
          case 'completed':
            return 'Plan approved';
          case 'failed':
            return 'Plan rejected';
          default:
            return 'Waiting for plan approval...';
        }
      }}
      loadingContent="Waiting for plan approval..."
      error={tool.error}
    />
  );
};

export const EnterPlanModeTool = memo(EnterPlanModeInner);
export const ExitPlanModeTool = memo(ExitPlanModeInner);
