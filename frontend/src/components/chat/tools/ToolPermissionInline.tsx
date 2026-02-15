import { useState, useCallback } from 'react';
import { ShieldAlert, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import type { PermissionRequest } from '@/types/chat.types';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
}

interface ToolPermissionInlineProps {
  request: PermissionRequest | null;
  onApprove: () => void;
  onReject: (alternativeInstruction?: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function ToolPermissionInline({
  request,
  onApprove,
  onReject,
  isLoading = false,
  error = null,
}: ToolPermissionInlineProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [alternativeInstruction, setAlternativeInstruction] = useState('');

  const handleRejectClick = useCallback(() => {
    if (showRejectInput && alternativeInstruction.trim()) {
      onReject(alternativeInstruction.trim());
      setAlternativeInstruction('');
      setShowRejectInput(false);
    } else {
      setShowRejectInput(true);
    }
  }, [showRejectInput, alternativeInstruction, onReject]);

  const handleJustReject = useCallback(() => {
    onReject();
    setShowRejectInput(false);
    setAlternativeInstruction('');
  }, [onReject]);

  if (!request || request.tool_name === 'AskUserQuestion' || request.tool_name === 'ExitPlanMode')
    return null;

  const hasParams = request.tool_input && Object.keys(request.tool_input).length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-tertiary dark:border-border-dark dark:bg-surface-dark-tertiary">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 dark:border-border-dark">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-black/5 p-1 dark:bg-white/10">
            <ShieldAlert className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
              Permission Required
            </span>
            <span className="ml-2 text-2xs text-text-secondary dark:text-text-dark-secondary">
              Tool:{' '}
              <code className="rounded bg-black/5 px-1 py-0.5 font-mono dark:bg-white/5">
                {request.tool_name}
              </code>
            </span>
          </div>
        </div>
      </div>

      <div className="max-h-[50vh] overflow-y-auto p-3">
        {hasParams ? (
          <div className="space-y-2">
            {Object.entries(request.tool_input).map(([key, value]) => (
              <div key={key} className="space-y-0.5">
                <div className="text-2xs font-medium uppercase tracking-wide text-text-tertiary dark:text-text-dark-tertiary">
                  {key}
                </div>
                <div className="overflow-auto rounded-md bg-black/5 px-2 py-1.5 text-xs text-text-primary dark:bg-white/5 dark:text-text-dark-primary">
                  <LazyMarkDown content={formatValue(value)} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-xs italic text-text-tertiary dark:text-text-dark-tertiary">
            No parameters
          </p>
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
              <Button onClick={onApprove} variant="primary" size="sm" disabled={isLoading}>
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
