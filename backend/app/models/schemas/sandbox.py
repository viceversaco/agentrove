from typing import Literal

from pydantic import BaseModel, Field, field_validator


class UpdateFileRequest(BaseModel):
    file_path: str = Field(..., min_length=1)
    content: str

    @field_validator("file_path")
    @classmethod
    def normalize_file_path(cls, v: str) -> str:
        if not v.startswith("/"):
            return f"/{v.lstrip('/')}"
        return v


class UpdateFileResponse(BaseModel):
    success: bool
    message: str


class FileMetadata(BaseModel):
    path: str
    type: str
    size: int
    modified: float
    is_binary: bool | None = None


class SandboxFilesMetadataResponse(BaseModel):
    files: list[FileMetadata]


class FileContentResponse(BaseModel):
    content: str
    path: str
    type: str
    is_binary: bool


class AddSecretRequest(BaseModel):
    key: str = Field(..., min_length=1)
    value: str = Field(..., min_length=1)


class UpdateSecretRequest(BaseModel):
    value: str = Field(..., min_length=1)


class UpdateIDEThemeRequest(BaseModel):
    theme: Literal["dark", "light"]


class IDEUrlResponse(BaseModel):
    url: str | None


class VNCUrlResponse(BaseModel):
    url: str | None


class StartBrowserRequest(BaseModel):
    url: str = Field(default="about:blank")


class BrowserStatusResponse(BaseModel):
    running: bool
    current_url: str | None = None


class GitDiffResponse(BaseModel):
    diff: str
    has_changes: bool
    is_git_repo: bool
    error: str | None = None


class GitBranchesResponse(BaseModel):
    branches: list[str]
    current_branch: str
    is_git_repo: bool


class GitCheckoutRequest(BaseModel):
    branch: str = Field(..., min_length=1, max_length=256)


class GitCheckoutResponse(BaseModel):
    success: bool
    current_branch: str
    error: str | None = None


class GitWorktree(BaseModel):
    path: str
    branch: str | None = None
    is_main: bool


class GitWorktreesResponse(BaseModel):
    worktrees: list[GitWorktree]
