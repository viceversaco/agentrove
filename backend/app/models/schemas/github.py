from pydantic import BaseModel


class GitHubRepo(BaseModel):
    name: str
    full_name: str
    description: str | None
    language: str | None
    html_url: str
    clone_url: str
    private: bool
    pushed_at: str | None
    stargazers_count: int


class GitHubReposResponse(BaseModel):
    items: list[GitHubRepo]
    has_more: bool
