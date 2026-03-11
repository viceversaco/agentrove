import { memo, useCallback, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { FileName } from './FileName';
import { FileIcon, FolderIcon } from './FileIcon';
import { useFileTreeContext } from './fileTreeContext';
import type { FileStructure } from '@/types/file-system.types';
import { getFileName } from '@/utils/file';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/primitives/Button';

export interface ItemProps {
  item: FileStructure;
  level: number;
  searchQuery?: string;
  matchedPaths?: Set<string>;
}

export const Item = memo(function Item({ item, level, searchQuery = '', matchedPaths }: ItemProps) {
  const { selectedFile, expandedFolders, onFileSelect, onToggleFolder, modifiedPaths } =
    useFileTreeContext('Item');
  const isFolder = item.type === 'folder';
  const isExpanded = isFolder && !!expandedFolders[item.path];
  const isSelected = selectedFile?.path === item.path;
  const isModified = !isFolder && modifiedPaths?.has(item.path);

  const indentStyle = useMemo(() => ({ paddingLeft: `${level * 8 + 4}px` }), [level]);

  const handleClick = useCallback(() => {
    if (isFolder) {
      onToggleFolder(item.path);
      return;
    }

    onFileSelect(item);
  }, [isFolder, item, onFileSelect, onToggleFolder]);

  return (
    <div>
      <Button
        onClick={handleClick}
        variant="unstyled"
        className={cn(
          'flex w-full items-center gap-1 px-1.5 py-[3px] text-left',
          'rounded-md transition-colors duration-150',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          isSelected &&
            'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary',
          !isSelected && 'text-text-tertiary dark:text-text-dark-tertiary',
        )}
        style={indentStyle}
      >
        {isFolder ? (
          <ChevronRight
            className={cn(
              'size-3 flex-shrink-0 transition-transform duration-200',
              'text-text-quaternary dark:text-text-dark-quaternary',
              isExpanded && 'rotate-90',
            )}
          />
        ) : (
          <div className="w-3 flex-shrink-0" />
        )}

        {isFolder ? (
          <FolderIcon isExpanded={isExpanded} className="size-3 flex-shrink-0" />
        ) : (
          <FileIcon name={getFileName(item.path)} className="size-3 flex-shrink-0" />
        )}

        <FileName
          path={item.path}
          isFolder={isFolder}
          searchQuery={searchQuery}
          className={cn('min-w-0 flex-1', isSelected && 'font-medium')}
        />

        {isModified && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-text-quaternary dark:bg-text-dark-quaternary" />
        )}
      </Button>

      {isFolder && isExpanded && item.children && (
        <div>
          {item.children.map((child: FileStructure) => (
            <Item
              key={child.path}
              item={child}
              level={level + 1}
              searchQuery={searchQuery}
              matchedPaths={matchedPaths}
            />
          ))}
        </div>
      )}
    </div>
  );
});
