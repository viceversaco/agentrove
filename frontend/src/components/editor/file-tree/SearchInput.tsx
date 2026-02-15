import { useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { cn } from '@/utils/cn';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = 'Search files...',
  className,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClear();
      inputRef.current?.blur();
    }
  };

  const handleClear = () => {
    onClear();
    inputRef.current?.focus();
  };

  useEffect(() => {
    const handleKeyboardShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        const activeElement = document.activeElement;
        const isInInput =
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement)?.contentEditable === 'true';

        if (!isInInput) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcut);
    return () => window.removeEventListener('keydown', handleKeyboardShortcut);
  }, []);

  return (
    <div role="search" className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />

      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label="Search files"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          'h-7 w-full py-1 pl-7 pr-7',
          'text-xs',
          'bg-transparent',
          'text-text-primary dark:text-text-dark-primary',
          'placeholder:text-text-quaternary dark:placeholder:text-text-dark-quaternary',
          'border border-border/50 dark:border-border-dark/50',
          'rounded-md',
          'focus:border-border-hover focus:outline-none dark:focus:border-border-dark-hover',
          'transition-colors duration-150',
        )}
      />

      {value && (
        <Button
          onClick={handleClear}
          variant="unstyled"
          className="absolute right-1 rounded p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:hover:text-text-dark-secondary"
          title="Clear search"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
