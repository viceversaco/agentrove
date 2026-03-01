export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  clone_url: string;
  private: boolean;
  pushed_at: string | null;
  stargazers_count: number;
}

export interface GitHubReposResponse {
  items: GitHubRepo[];
  has_more: boolean;
}
