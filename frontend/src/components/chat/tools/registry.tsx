import { lazy } from 'react';
import type { ToolComponent } from '@/types/ui.types';
type ToolModuleLoader = () => Promise<{ default: ToolComponent }>;

const toLazy = (loader: ToolModuleLoader): ToolComponent =>
  lazy(loader) as unknown as ToolComponent;

const toolLoaders: Record<string, ToolModuleLoader> = {
  Task: () => import('./Task').then((m) => ({ default: m.Task })),
  WebSearch: () => import('./WebSearch').then((m) => ({ default: m.WebSearch })),
  TodoWrite: () => import('./TodoWrite').then((m) => ({ default: m.TodoWrite })),
  Write: () => import('./FileOperationTool').then((m) => ({ default: m.WriteTool })),
  Read: () => import('./FileOperationTool').then((m) => ({ default: m.ReadTool })),
  Edit: () => import('./FileOperationTool').then((m) => ({ default: m.EditTool })),
  AskUserQuestion: () => import('./AskUserQuestion').then((m) => ({ default: m.AskUserQuestion })),
  Bash: () => import('./BashTool').then((m) => ({ default: m.BashTool })),
  Glob: () => import('./GlobTool').then((m) => ({ default: m.GlobTool })),
  Grep: () => import('./GrepTool').then((m) => ({ default: m.GrepTool })),
  NotebookEdit: () => import('./NotebookEditTool').then((m) => ({ default: m.NotebookEditTool })),
  WebFetch: () => import('./WebFetchTool').then((m) => ({ default: m.WebFetchTool })),
  LSP: () => import('./LSPTool').then((m) => ({ default: m.LSPTool })),
  TaskOutput: () => import('./TaskOutputTool').then((m) => ({ default: m.TaskOutputTool })),
  BashOutput: () => import('./TaskOutputTool').then((m) => ({ default: m.BashOutputTool })),
  KillShell: () => import('./KillShellTool').then((m) => ({ default: m.KillShellTool })),
  EnterPlanMode: () => import('./PlanModeTool').then((m) => ({ default: m.EnterPlanModeTool })),
  ExitPlanMode: () => import('./PlanModeTool').then((m) => ({ default: m.ExitPlanModeTool })),
};

const mcpLoader: ToolModuleLoader = () => import('./MCPTool').then((m) => ({ default: m.MCPTool }));
const webSearchLoader: ToolModuleLoader = () =>
  import('./WebSearch').then((m) => ({ default: m.WebSearch }));

const lazyToolComponents = new Map<string, ToolComponent>();

const getOrCreateLazy = (key: string, loader: ToolModuleLoader) => {
  const existing = lazyToolComponents.get(key);
  if (existing) return existing;
  const component = toLazy(loader);
  lazyToolComponents.set(key, component);
  return component;
};

export const getToolComponent = (toolName: string): ToolComponent => {
  if (toolLoaders[toolName]) {
    return getOrCreateLazy(toolName, toolLoaders[toolName]);
  }

  if (
    toolName.startsWith('mcp__web-search-prime__') ||
    toolName.startsWith('mcp__web_search_prime__')
  ) {
    return getOrCreateLazy(toolName, webSearchLoader);
  }

  return getOrCreateLazy(toolName, mcpLoader);
};
