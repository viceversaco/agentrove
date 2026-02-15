import { StreamProcessingError } from '@/types';
import { Button } from '@/components/ui/primitives/Button';

interface ErrorMessageProps {
  error: Error;
  onDismiss?: () => void;
}

export function ErrorMessage({ error, onDismiss }: ErrorMessageProps) {
  const errorMessage =
    error instanceof StreamProcessingError ? error.getDetailedMessage() : error.message;

  return (
    <div className="relative mx-4 my-4 animate-fadeIn">
      <div className="overflow-hidden rounded-lg border border-error-200 bg-gradient-to-r from-error-50 to-error-100/50 shadow-soft backdrop-blur-sm dark:border-error-700/30 dark:from-error-900/20 dark:to-error-800/10">
        <div className="px-4 py-3">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg
                className="mt-0.5 h-5 w-5 text-error-500 dark:text-error-400"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 8a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-error-800 dark:text-error-200">
                Stream Error
              </h3>
              <div className="mt-1 text-sm text-error-700 dark:text-error-300">{errorMessage}</div>
            </div>
            {onDismiss && (
              <div className="ml-auto pl-3">
                <Button
                  onClick={onDismiss}
                  variant="unstyled"
                  className="inline-flex rounded-md bg-error-50 p-1.5 text-error-500 transition-colors duration-200 hover:bg-error-100 focus:outline-none focus:ring-2 focus:ring-error-600 focus:ring-offset-2 dark:bg-error-900/20 dark:text-error-400 dark:hover:bg-error-900/30 dark:focus:ring-offset-surface-dark"
                >
                  <span className="sr-only">Dismiss</span>
                  <svg
                    className="h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
