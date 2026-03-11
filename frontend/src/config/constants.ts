import type { CustomAgent } from '@/types/user.types';

export const SandboxProvider = {
  DOCKER: 'docker',
  HOST: 'host',
} as const;

export type SandboxProviderType = (typeof SandboxProvider)[keyof typeof SandboxProvider];

export const CONTEXT_WINDOW_TOKENS = 200_000;

export const MAX_MESSAGE_SIZE_BYTES = 100000;

export const MAX_UPLOAD_SIZE_BYTES = {
  AGENT: 100 * 1024,
  COMMAND: 100 * 1024,
  SKILL: 10 * 1024 * 1024,
  CHAT_ATTACHMENT: 5 * 1024 * 1024,
} as const;

export const DROPDOWN_WIDTH = 128;
export const DROPDOWN_HEIGHT = 90;
export const DROPDOWN_MARGIN = 8;

export const BUILT_IN_AGENTS: CustomAgent[] = [
  {
    name: 'Explore',
    description:
      'Fast agent specialized for exploring codebases. Use for finding files by patterns, searching code for keywords, or answering questions about the codebase. Supports thoroughness levels: quick, medium, or very thorough.',
    content: '',
    enabled: true,
    model: 'haiku',
  },
  {
    name: 'Plan',
    description:
      'Agent specialized for codebase planning and architecture analysis. Use for understanding code structure, planning implementations, or exploring dependencies. Supports thoroughness levels: quick, medium, or very thorough.',
    content: '',
    enabled: true,
    model: 'sonnet',
  },
];

export const MONACO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export const MONACO_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  wordWrap: 'on' as const,
  automaticLayout: true,
  fontSize: 13,
  lineNumbers: 'on' as const,
  scrollBeyondLastLine: false,
  fontFamily: MONACO_FONT_FAMILY,
};

export const MOBILE_BREAKPOINT = 768;

export const AVAILABLE_CLAUDE_TOOLS = [
  'Agent',
  'Bash',
  'BashOutput',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'KillShell',
  'LS',
  'MultiEdit',
  'NotebookEdit',
  'NotebookRead',
  'Read',
  'Skill',
  'SlashCommand',
  'TodoRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
] as const;

export type ClaudeTool = (typeof AVAILABLE_CLAUDE_TOOLS)[number];
