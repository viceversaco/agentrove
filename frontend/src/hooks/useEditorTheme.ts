import { useCallback } from 'react';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import type * as monaco from 'monaco-editor';

const LIGHT_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '24292E', background: '#f9f9f9' },
    { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
    { token: 'keyword', foreground: '6B4C9A' },
    { token: 'string', foreground: '4A6B3F' },
    { token: 'number', foreground: '6B4C9A' },
    { token: 'type', foreground: '5A5A5A' },
    { token: 'variable', foreground: '24292E' },
    { token: 'function', foreground: '3D3D3D' },
  ],
  colors: {
    'editor.background': '#f9f9f9',
    'editor.foreground': '#24292E',
    'editorLineNumber.foreground': '#C0C0C0',
    'editorLineNumber.activeForeground': '#8B8B8B',
    'editor.selectionBackground': '#E0E0E0',
    'editor.inactiveSelectionBackground': '#EBEBEB',
    'editorCursor.foreground': '#24292E',
    'editor.findMatchBackground': '#E8E8E8',
    'editor.findMatchHighlightBackground': '#F0F0F0',
    'editorSuggestWidget.background': '#FFFFFF',
    'editorSuggestWidget.foreground': '#333333',
    'editorSuggestWidget.selectedBackground': '#F0F0F0',
    'editorSuggestWidget.border': '#E5E5E5',
    'editorWidget.background': '#FFFFFF',
    'editorWidget.border': '#E5E5E5',
    'editor.lineHighlightBackground': '#00000005',
    'editorIndentGuide.background': '#00000000',
    'editorIndentGuide.activeBackground': '#00000000',
    'scrollbar.shadow': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  },
};

const DARK_THEME: monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'B0B0B0', background: '#141414' },
    { token: 'comment', foreground: '555555', fontStyle: 'italic' },
    { token: 'keyword', foreground: '9B8ABF' },
    { token: 'string', foreground: 'A3B38B' },
    { token: 'number', foreground: '9B8ABF' },
    { token: 'type', foreground: '8A8A8A' },
    { token: 'variable', foreground: 'B0B0B0' },
    { token: 'function', foreground: 'C8C8C8' },
  ],
  colors: {
    'editor.background': '#141414',
    'editor.foreground': '#B0B0B0',
    'editorLineNumber.foreground': '#3A3A3A',
    'editorLineNumber.activeForeground': '#606060',
    'editor.selectionBackground': '#2A2A2A',
    'editor.inactiveSelectionBackground': '#222222',
    'editorCursor.foreground': '#B0B0B0',
    'editor.findMatchBackground': '#2A2A2A',
    'editor.findMatchHighlightBackground': '#333333',
    'editorSuggestWidget.background': '#1A1A1A',
    'editorSuggestWidget.foreground': '#A0A0A0',
    'editorSuggestWidget.selectedBackground': '#252525',
    'editorSuggestWidget.border': '#2A2A2A',
    'editorWidget.background': '#1A1A1A',
    'editorWidget.border': '#2A2A2A',
    'editor.lineHighlightBackground': '#FFFFFF05',
    'editorIndentGuide.background': '#00000000',
    'editorIndentGuide.activeBackground': '#00000000',
    'scrollbar.shadow': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  },
};

export function useEditorTheme() {
  const theme = useResolvedTheme();

  const setupEditorTheme = useCallback(
    (monaco: typeof import('monaco-editor')) => {
      if (!monaco || !monaco.editor) return;

      monaco.editor.defineTheme('custom-light', LIGHT_THEME);
      monaco.editor.defineTheme('custom-dark', DARK_THEME);

      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        jsx: monaco.languages.typescript.JsxEmit.React,
        lib: ['es2020', 'dom'],
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      });

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        jsx: monaco.languages.typescript.JsxEmit.React,
        lib: ['es2020', 'dom'],
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      });

      monaco.editor.setTheme(theme === 'dark' ? 'custom-dark' : 'custom-light');
    },
    [theme],
  );

  return {
    currentTheme: theme === 'light' ? 'custom-light' : 'custom-dark',
    setupEditorTheme,
  };
}
