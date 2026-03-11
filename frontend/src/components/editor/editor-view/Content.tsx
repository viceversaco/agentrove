import { memo } from 'react';
import Editor from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { MONACO_FONT_FAMILY } from '@/config/constants';

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  suggestOnTriggerCharacters: true,
  quickSuggestions: {
    other: true,
    comments: true,
    strings: true,
  },
  snippetSuggestions: 'inline',
  fontFamily: MONACO_FONT_FAMILY,
  fontSize: 12,
  lineHeight: 1.5,
  renderLineHighlight: 'none',
  scrollbar: {
    useShadows: false,
    vertical: 'auto',
    horizontal: 'auto',
    horizontalScrollbarSize: 6,
    verticalScrollbarSize: 6,
  },
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  guides: {
    indentation: false,
  },
  renderLineHighlightOnlyWhenFocus: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
} as const;

export interface ContentProps {
  content: string;
  language: string;
  isReadOnly: boolean;
  onChange: (value: string | undefined) => void;
  onMount: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => void;
  theme: string;
}

export const Content = memo(function Content({
  content,
  language,
  isReadOnly,
  onChange,
  onMount,
  theme,
}: ContentProps) {
  return (
    <div className="h-full">
      <Editor
        height="100%"
        language={language}
        path={`file://${language}`}
        value={content}
        onChange={onChange}
        theme={theme}
        options={{
          ...EDITOR_OPTIONS,
          readOnly: isReadOnly,
        }}
        onMount={onMount}
        loading={
          <div
            className={`flex h-full items-center justify-center text-xs text-text-quaternary ${theme === 'custom-light' ? 'bg-surface-secondary' : 'bg-surface-dark-secondary'}`}
          >
            <div className="animate-pulse">Loading editor...</div>
          </div>
        }
        className={theme === 'custom-light' ? 'bg-surface-secondary' : 'bg-surface-dark-secondary'}
      />
    </div>
  );
});
