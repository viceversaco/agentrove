import { useState, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import { BaseModal } from '@/components/ui/shared/BaseModal';
import { Button } from '@/components/ui/primitives/Button';
import { Tree } from '@/components/editor/file-tree/Tree';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type { CustomSkill } from '@/types/user.types';
import type { FileStructure } from '@/types/file-system.types';
import { skillService, type SkillFileEntry } from '@/services/skillService';
import { MONACO_EDITOR_OPTIONS } from '@/config/constants';
import { detectLanguage, sortFiles } from '@/utils/file';

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
  const [selectedFile, setSelectedFile] = useState<FileStructure | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [modifiedFiles, setModifiedFiles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const theme = useResolvedTheme();

  const fileTree = useMemo(() => skillFilesToFileTree(files), [files]);

  const modifiedPathsKey = useMemo(() => [...modifiedFiles.keys()].sort().join('\0'), [modifiedFiles]);
  const modifiedPaths = useMemo(
    () => new Set(modifiedPathsKey ? modifiedPathsKey.split('\0') : []),
    [modifiedPathsKey],
  );

  useEffect(() => {
    if (!isOpen || !skill) return;
    setFiles([]);
    setSelectedFile(null);
    setExpandedFolders({});
    setModifiedFiles(new Map());
    setLoadError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const loaded = await skillService.getSkillFiles(skill.name);
        if (cancelled) return;
        setFiles(loaded);
        setExpandedFolders(collectFolderPathsFromFiles(loaded));
        const firstTextFile = loaded.find((f) => !f.is_binary);
        if (firstTextFile) {
          setSelectedFile({ path: firstTextFile.path, content: firstTextFile.content, type: 'file', is_binary: false });
        }
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

  const selectedSkillFile = useMemo(
    () => files.find((f) => f.path === selectedFile?.path) ?? null,
    [files, selectedFile],
  );

  const currentContent = useMemo(() => {
    if (!selectedSkillFile) return '';
    if (modifiedFiles.has(selectedSkillFile.path)) return modifiedFiles.get(selectedSkillFile.path)!;
    return selectedSkillFile.content;
  }, [selectedSkillFile, modifiedFiles]);

  const hasChanges = modifiedFiles.size > 0;

  const handleEditorChange = (value: string | undefined) => {
    if (!selectedFile) return;
    const original = files.find((f) => f.path === selectedFile.path);
    if (!original) return;

    setModifiedFiles((prev) => {
      const next = new Map(prev);
      if (value === original.content) {
        next.delete(selectedFile.path);
      } else {
        next.set(selectedFile.path, value ?? '');
      }
      return next;
    });
  };

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

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
        <div className="w-52 shrink-0 overflow-y-auto border-r border-border dark:border-border-dark">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-6 animate-pulse rounded bg-surface-secondary dark:bg-surface-dark-secondary"
                />
              ))}
            </div>
          ) : loadError ? (
            <p className="p-4 text-xs text-text-tertiary dark:text-text-dark-tertiary">
              {loadError}
            </p>
          ) : (
            <Tree
              files={fileTree}
              selectedFile={selectedFile}
              expandedFolders={expandedFolders}
              onFileSelect={setSelectedFile}
              onToggleFolder={handleToggleFolder}
              modifiedPaths={modifiedPaths}
            />
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {!selectedSkillFile ? (
            <div className="flex h-full items-center justify-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
              {loading ? 'Loading...' : 'Select a file to edit'}
            </div>
          ) : selectedSkillFile.is_binary ? (
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
                language={detectLanguage(selectedSkillFile.path)}
                value={currentContent}
                onChange={handleEditorChange}
                theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                options={MONACO_EDITOR_OPTIONS}
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

function skillFilesToFileTree(files: SkillFileEntry[]): FileStructure[] {
  const root: FileStructure[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.path === partPath);
      if (!existing) {
        existing = isLast
          ? { path: partPath, content: file.content, type: 'file' as const, is_binary: file.is_binary }
          : { path: partPath, content: '', type: 'folder' as const, children: [] };
        current.push(existing);
      }

      if (!isLast) {
        if (!existing.children) existing.children = [];
        current = existing.children;
      }
    }
  }

  return sortFiles(root);
}

function collectFolderPathsFromFiles(files: SkillFileEntry[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const file of files) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      result[parts.slice(0, i).join('/')] = true;
    }
  }
  return result;
}
