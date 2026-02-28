export type WorkspaceSourceType = 'git' | 'local' | 'empty';

export interface Workspace {
  id: string;
  name: string;
  user_id: string;
  sandbox_id: string;
  sandbox_provider: string;
  workspace_path: string;
  source_type?: string | null;
  source_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceRequest {
  name: string;
  source_type: WorkspaceSourceType;
  workspace_path?: string;
  git_url?: string;
  sandbox_provider?: 'docker' | 'host';
}

export interface UpdateWorkspaceRequest {
  name?: string;
}
