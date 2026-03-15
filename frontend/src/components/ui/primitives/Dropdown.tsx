import { memo, ReactNode, useState, useEffect, KeyboardEvent } from 'react';
import { Check, ChevronDown, LucideIcon, Search, X } from 'lucide-react';
import { useDropdown } from '@/hooks/useDropdown';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from '@/components/ui/primitives/Button';
import { SelectItem } from '@/components/ui/primitives/SelectItem';
import { fuzzySearch } from '@/utils/fuzzySearch';
import { cn } from '@/utils/cn';

export type DropdownItemType<T> = { type: 'item'; data: T } | { type: 'header'; label: string };

export interface DropdownProps<T> {
  value: T;
  items: readonly T[] | readonly DropdownItemType<T>[];
  getItemKey: (item: T) => string;
  getItemLabel: (item: T) => string;
  getItemShortLabel?: (item: T) => string;
  onSelect: (item: T) => void;
  renderItem?: (item: T, isSelected: boolean) => ReactNode;
  leftIcon?: LucideIcon;
  width?: string;
  itemClassName?: string;
  dropdownPosition?: 'top' | 'bottom';
  disabled?: boolean;
  compactOnMobile?: boolean;
  forceCompact?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

const isGroupedItems = <T,>(
  items: readonly T[] | readonly DropdownItemType<T>[],
): items is readonly DropdownItemType<T>[] => {
  return (
    items.length > 0 && typeof items[0] === 'object' && items[0] !== null && 'type' in items[0]
  );
};

function DropdownInner<T>({
  value,
  items,
  getItemKey,
  getItemLabel,
  getItemShortLabel,
  onSelect,
  renderItem,
  leftIcon: LeftIcon,
  width = 'w-40',
  itemClassName,
  dropdownPosition = 'bottom',
  disabled = false,
  compactOnMobile = false,
  forceCompact = false,
  searchable = false,
  searchPlaceholder = 'Search...',
}: DropdownProps<T>) {
  const { isOpen, dropdownRef, setIsOpen } = useDropdown();
  const [searchQuery, setSearchQuery] = useState('');
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  const filterItems = (itemsToFilter: readonly T[]): T[] => {
    if (!searchQuery.trim()) return itemsToFilter as T[];
    const isStringItems = itemsToFilter.length > 0 && typeof itemsToFilter[0] === 'string';
    return fuzzySearch(searchQuery, [...itemsToFilter], {
      keys: isStringItems ? undefined : ['name', 'label'],
      limit: 50,
    });
  };

  const getFilteredGroupedItems = (): DropdownItemType<T>[] => {
    if (!isGroupedItems(items)) return [];
    if (!searchQuery.trim()) return [...items];

    const result: DropdownItemType<T>[] = [];
    let currentHeader: string | null = null;
    const pendingItems: T[] = [];

    for (const item of items) {
      if (item.type === 'header') {
        if (pendingItems.length > 0 && currentHeader) {
          const filtered = filterItems(pendingItems);
          if (filtered.length > 0) {
            result.push({ type: 'header', label: currentHeader });
            filtered.forEach((data) => result.push({ type: 'item', data }));
          }
        }
        currentHeader = item.label;
        pendingItems.length = 0;
      } else {
        pendingItems.push(item.data);
      }
    }

    if (pendingItems.length > 0 && currentHeader) {
      const filtered = filterItems(pendingItems);
      if (filtered.length > 0) {
        result.push({ type: 'header', label: currentHeader });
        filtered.forEach((data) => result.push({ type: 'item', data }));
      }
    }

    return result;
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (searchQuery) {
        setSearchQuery('');
      } else {
        setIsOpen(false);
      }
    }
  };

  const displayItems = isGroupedItems(items)
    ? getFilteredGroupedItems()
    : filterItems(items as readonly T[]);

  const showIconOnly = (compactOnMobile || forceCompact) && LeftIcon;
  const labelClasses = showIconOnly
    ? forceCompact
      ? 'hidden whitespace-nowrap text-2xs font-medium text-text-primary dark:text-text-dark-secondary'
      : 'hidden sm:inline whitespace-nowrap text-2xs font-medium text-text-primary dark:text-text-dark-secondary'
    : 'whitespace-nowrap text-2xs font-medium text-text-primary dark:text-text-dark-secondary';
  const chevronClasses = showIconOnly
    ? forceCompact
      ? 'hidden'
      : 'hidden sm:block h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary transition-transform duration-200'
    : 'h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary transition-transform duration-200';

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        variant="unstyled"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-colors duration-200 ${isOpen && !disabled ? 'bg-surface-hover dark:bg-surface-dark-hover' : 'hover:bg-surface-hover/60 dark:hover:bg-surface-dark-hover/60'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        {LeftIcon && (
          <LeftIcon
            className={cn('h-3 w-3 text-text-tertiary dark:text-text-dark-tertiary', !forceCompact && 'sm:hidden')}
          />
        )}
        <span className={labelClasses}>
          {getItemShortLabel ? getItemShortLabel(value) : getItemLabel(value)}
        </span>
        {!disabled && <ChevronDown className={`${chevronClasses} ${isOpen ? 'rotate-180' : ''}`} />}
      </Button>

      {isOpen && !disabled && (
        <div
          role="listbox"
          className={`absolute left-0 ${width} z-[60] rounded-xl border border-border bg-surface-secondary/95 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95 dark:shadow-black/40 ${dropdownPosition === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          {searchable && (
            <div className="border-b border-border p-1.5 dark:border-border-dark">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={searchPlaceholder}
                  autoFocus={!isMobile}
                  className="h-7 w-full rounded-lg border border-border bg-surface-tertiary py-1 pl-7 pr-7 text-2xs text-text-primary transition-colors duration-200 placeholder:text-text-quaternary focus:border-border-hover focus:outline-none dark:border-border-dark dark:bg-surface-dark-tertiary dark:text-text-dark-primary dark:placeholder:text-text-dark-quaternary dark:focus:border-border-dark-hover"
                />
                {searchQuery && (
                  <Button
                    onClick={() => setSearchQuery('')}
                    variant="unstyled"
                    aria-label="Clear search"
                    className="absolute right-1 rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:bg-surface-hover hover:text-text-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-secondary"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="max-h-64 space-y-px overflow-y-auto p-1">
            {isGroupedItems(items)
              ? (displayItems as DropdownItemType<T>[]).map((item, index) => {
                  if (item.type === 'header') {
                    return (
                      <div
                        key={`header-${item.label}`}
                        className={`px-2 pb-0.5 pt-1.5 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary ${index === 0 ? '' : 'mt-1 border-t border-border dark:border-border-dark'}`}
                      >
                        {item.label}
                      </div>
                    );
                  }

                  const isSelected = getItemKey(item.data) === getItemKey(value);
                  return (
                    <SelectItem
                      key={getItemKey(item.data)}
                      isSelected={isSelected}
                      role="option"
                      onSelect={() => {
                        onSelect(item.data);
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={`h-3 w-3 flex-shrink-0 transition-opacity duration-150 ${isSelected ? 'text-text-primary opacity-100 dark:text-text-dark-primary' : 'opacity-0'}`}
                      />
                      <div className={`min-w-0 flex-1${itemClassName ? ` ${itemClassName}` : ''}`}>
                        {renderItem ? (
                          renderItem(item.data, isSelected)
                        ) : (
                          <span
                            className={`text-2xs font-medium ${
                              isSelected
                                ? 'text-text-primary dark:text-text-dark-primary'
                                : 'text-text-secondary dark:text-text-dark-secondary'
                            }`}
                          >
                            {getItemLabel(item.data)}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })
              : (displayItems as T[]).map((item) => {
                  const isSelected = getItemKey(item) === getItemKey(value);
                  return (
                    <SelectItem
                      key={getItemKey(item)}
                      isSelected={isSelected}
                      role="option"
                      onSelect={() => {
                        onSelect(item);
                        setIsOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={`h-3 w-3 flex-shrink-0 transition-opacity duration-150 ${isSelected ? 'text-text-primary opacity-100 dark:text-text-dark-primary' : 'opacity-0'}`}
                      />
                      <div className={`min-w-0 flex-1${itemClassName ? ` ${itemClassName}` : ''}`}>
                        {renderItem ? (
                          renderItem(item, isSelected)
                        ) : (
                          <span
                            className={`text-2xs font-medium ${
                              isSelected
                                ? 'text-text-primary dark:text-text-dark-primary'
                                : 'text-text-secondary dark:text-text-dark-secondary'
                            }`}
                          >
                            {getItemLabel(item)}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
          </div>
        </div>
      )}
    </div>
  );
}

export const Dropdown = memo(DropdownInner) as <T>(props: DropdownProps<T>) => JSX.Element;
