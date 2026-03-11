import { useState, useEffect, lazy, Suspense, useMemo } from 'react';
import { File, Folder } from 'lucide-react';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type { CustomSkill } from '@/types/user.types';
import { skillService, type SkillFileEntry } from '@/services/skillService';
import { cn } from '@/utils/cn';
import { detectLanguage } from '@/utils/file';

const Editor = lazy(() => import('@monaco-editor/react'));

interface SkillEditDialogProps {
  isOpen: boolean;
  skill: CustomSkill | null;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}

export const SkillEditDialog: React.FC<SkillEditDialogProps> = ({
  isOpen,
  skill,
  error,
  saving,
  onClose,
  onSave,
}) => {
  const [files, setFiles] = useState<SkillFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [modifiedFiles, setModifiedFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    if (!isOpen || !skill) return;
    setFiles([]);
    setSelectedPath(null);
    setModifiedFiles(new Map());
    setLoadError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const loaded = await skillService.getSkillFiles(skill.name);
        if (cancelled) return;
        setFiles(loaded);
        const firstTextFile = loaded.find((f) => !f.is_binary);
        if (firstTextFile) setSelectedPath(firstTextFile.path);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load skill files');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, skill]);

  const selectedFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? null,
    [files, selectedPath],
  );

  const currentContent = useMemo(() => {
    if (!selectedFile) return '';
    if (modifiedFiles.has(selectedFile.path)) return modifiedFiles.get(selectedFile.path)!;
    return selectedFile.content;
  }, [selectedFile, modifiedFiles]);

  const hasChanges = modifiedFiles.size > 0;

  const handleEditorChange = (value: string | undefined) => {
    if (!selectedPath) return;

    setModifiedFiles((prev) => {
      const original = files.find((f) => f.path === selectedPath);
      if (!original) return prev;
      const next = new Map(prev);
      if (value === original.content) {
        next.delete(selectedPath);
      } else {
        next.set(selectedPath, value ?? '');
      }
      return next;
    });
  };

  const handleSave = async () => {
    const merged = files.map((f) => {
      const modified = modifiedFiles.get(f.path);
      if (modified !== undefined) {
        return { ...f, content: modified };
      }
      return f;
    });
    await onSave(JSON.stringify(merged));
  };

  if (!isOpen || !skill) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 dark:border-border-dark">
        <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
          Edit Skill: {skill.name}
        </h3>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="text-text-quaternary transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-quaternary/30 dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex h-[600px]">
        <div className="w-52 shrink-0 overflow-y-auto border-r border-border p-2 dark:border-border-dark">
          {loading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-6 animate-pulse rounded bg-surface-secondary dark:bg-surface-dark-secondary"
                />
              ))}
            </div>
          ) : loadError ? (
            <p className="p-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {loadError}
            </p>
          ) : (
            <FileTree
              files={files}
              selectedPath={selectedPath}
              modifiedPaths={modifiedFiles}
              onSelect={setSelectedPath}
            />
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {!selectedFile ? (
            <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              {loading ? 'Loading...' : 'Select a file to edit'}
            </div>
          ) : selectedFile.is_binary ? (
            <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              Binary file cannot be edited
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="h-full animate-pulse bg-surface-secondary dark:bg-surface-dark-secondary" />
              }
            >
              <Editor
                height="100%"
                language={detectLanguage(selectedFile.path)}
                value={currentContent}
                onChange={handleEditorChange}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  automaticLayout: true,
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                }}
                loading={
                  <div className="flex h-full items-center justify-center text-text-quaternary dark:text-text-dark-quaternary">
                    Loading editor...
                  </div>
                }
              />
            </Suspense>
          )}
        </div>
      </div>

      {(error || loadError) && (
        <div className="px-5 pb-2">
          <div className="rounded-xl border border-border p-3 dark:border-border-dark">
            <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
              {error || loadError}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3 dark:border-border-dark">
        <Button onClick={onClose} variant="outline" size="sm" disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="outline"
          size="sm"
          className="border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
          isLoading={saving}
          disabled={!hasChanges}
        >
          Save Changes
        </Button>
      </div>
    </BaseModal>
  );
};

interface FileTreeProps {
  files: SkillFileEntry[];
  selectedPath: string | null;
  modifiedPaths: Map<string, string>;
  onSelect: (path: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(files: SkillFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = {
          name,
          path: partPath,
          isDir: !isLast,
          children: [],
        };
        current.push(existing);
      }

      if (!isLast) {
        current = existing.children;
      }
    }
  }

  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children);
  }
  return nodes;
}

function FileTree({ files, selectedPath, modifiedPaths, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="space-y-px">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          modifiedPaths={modifiedPaths}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  modifiedPaths: Map<string, string>;
  onSelect: (path: string) => void;
}

function TreeItem({ node, depth, selectedPath, modifiedPaths, onSelect }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = node.path === selectedPath;
  const isModified = modifiedPaths.has(node.path);

  if (node.isDir) {
    return (
      <>
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-2xs text-text-secondary transition-colors hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <Folder className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              modifiedPaths={modifiedPaths}
              onSelect={onSelect}
            />
          ))}
      </>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-2xs transition-colors',
        isSelected
          ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
          : 'text-text-secondary hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <File className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
      <span className="truncate">{node.name}</span>
      {isModified && (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-text-quaternary dark:bg-text-dark-quaternary" />
      )}
    </button>
  );
}
