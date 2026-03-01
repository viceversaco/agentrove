export const queryKeys = {
  chats: 'chats',
  chat: (chatId: string) => ['chat', chatId] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
  contextUsage: (chatId: string) => ['chat', chatId, 'context-usage'] as const,
  auth: {
    user: 'auth-user',
  },
  settings: 'settings',
  sandbox: {
    previewLinks: (sandboxId: string) => ['sandbox', sandboxId, 'preview-links'] as const,
    fileContent: (sandboxId: string, filePath: string) =>
      ['sandbox', sandboxId, 'file-content', filePath] as const,
    filesMetadata: (sandboxId: string) => ['sandbox', sandboxId, 'files-metadata'] as const,
    secrets: (sandboxId: string) => ['sandbox', sandboxId, 'secrets'] as const,
    ideUrl: (sandboxId: string) => ['sandbox', sandboxId, 'ide-url'] as const,
    vncUrl: (sandboxId: string) => ['sandbox', sandboxId, 'vnc-url'] as const,
    browserStatus: (sandboxId: string) => ['sandbox', sandboxId, 'browser-status'] as const,
  },
  workspaces: ['workspaces'] as const,
  models: 'models',
  scheduler: {
    tasks: ['scheduler', 'tasks'] as const,
    task: (taskId: string) => ['scheduler', 'tasks', taskId] as const,
    history: (taskId: string) => ['scheduler', 'tasks', taskId, 'history'] as const,
  },
  marketplace: {
    catalog: ['marketplace', 'catalog'] as const,
    pluginDetails: (pluginName: string) => ['marketplace', 'plugin', pluginName] as const,
    installed: ['marketplace', 'installed'] as const,
  },
  github: {
    repos: (query: string) => ['github-repos', query] as const,
  },
} as const;
