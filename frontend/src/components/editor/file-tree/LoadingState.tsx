import { Spinner } from '@/components/ui/primitives/Spinner';

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12">
      <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
      <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
        Loading files...
      </p>
    </div>
  );
}
