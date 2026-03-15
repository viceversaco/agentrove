import asyncio
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.constants import SANDBOX_HOME_DIR, SANDBOX_WORKSPACE_DIR
from app.core.deps import get_sandbox_service, validate_sandbox_ownership
from app.models.schemas.chat import PortPreviewLink, PreviewLinksResponse
from app.models.schemas.sandbox import (
    AddSecretRequest,
    BrowserStatusResponse,
    FileContentResponse,
    FileMetadata,
    GitBranchesResponse,
    GitCheckoutRequest,
    GitCheckoutResponse,
    GitDiffResponse,
    GitWorktree,
    GitWorktreesResponse,
    IDEUrlResponse,
    SandboxFilesMetadataResponse,
    StartBrowserRequest,
    UpdateFileRequest,
    UpdateFileResponse,
    UpdateIDEThemeRequest,
    UpdateSecretRequest,
    VNCUrlResponse,
)
from app.models.schemas.secrets import (
    MessageResponse,
    SecretResponse,
    SecretsListResponse,
)
from app.services.exceptions import SandboxException
from app.services.sandbox import SandboxService


router = APIRouter()

GIT_CD_PREFIX = f"cd {SANDBOX_WORKSPACE_DIR} 2>/dev/null || cd {SANDBOX_HOME_DIR}; "
BRANCH_NAME_RE = re.compile(r"^[\w./-]+$")
CWD_PATH_RE = re.compile(r"^/[a-zA-Z0-9/_.\- ]+$")


def _git_cd_prefix(cwd: str | None = None) -> str:
    if cwd and CWD_PATH_RE.match(cwd):
        return f"cd '{cwd}'; "
    return GIT_CD_PREFIX


@router.get("/{sandbox_id}/preview-links", response_model=PreviewLinksResponse)
async def get_preview_links(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> PreviewLinksResponse:
    links = await sandbox_service.get_preview_links(sandbox_id)
    return PreviewLinksResponse(links=[PortPreviewLink(**link) for link in links])


@router.get("/{sandbox_id}/ide-url", response_model=IDEUrlResponse)
async def get_ide_url(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> IDEUrlResponse:
    url = await sandbox_service.get_ide_url(sandbox_id)
    return IDEUrlResponse(url=url)


@router.get("/{sandbox_id}/vnc-url", response_model=VNCUrlResponse)
async def get_vnc_url(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> VNCUrlResponse:
    url = await sandbox_service.provider.get_vnc_url(sandbox_id)
    return VNCUrlResponse(url=url)


@router.post("/{sandbox_id}/browser/start", response_model=BrowserStatusResponse)
async def start_browser(
    request: StartBrowserRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> BrowserStatusResponse:
    try:
        await sandbox_service.start_browser(sandbox_id, request.url)
        return BrowserStatusResponse(running=True, current_url=request.url)
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/browser/stop", response_model=MessageResponse)
async def stop_browser(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> MessageResponse:
    try:
        await sandbox_service.stop_browser(sandbox_id)
        return MessageResponse(message="Browser stopped")
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/browser/status", response_model=BrowserStatusResponse)
async def get_browser_status(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> BrowserStatusResponse:
    result = await sandbox_service.get_browser_status(sandbox_id)
    return BrowserStatusResponse(running=result.get("running", False))


@router.get(
    "/{sandbox_id}/files/metadata",
    response_model=SandboxFilesMetadataResponse,
)
async def get_files_metadata(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> SandboxFilesMetadataResponse:
    files = await sandbox_service.get_files_metadata(sandbox_id)
    return SandboxFilesMetadataResponse(files=[FileMetadata(**f) for f in files])


def _normalize_file_path(file_path: str) -> str:
    if file_path.startswith("/") and not file_path.startswith(SANDBOX_HOME_DIR):
        return file_path.lstrip("/")
    return file_path


@router.get(
    "/{sandbox_id}/files/content/{file_path:path}", response_model=FileContentResponse
)
async def get_file_content(
    file_path: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> FileContentResponse:
    try:
        file_data = await sandbox_service.get_file_content(
            sandbox_id, _normalize_file_path(file_path)
        )
        return FileContentResponse(**file_data)
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.put("/{sandbox_id}/files", response_model=UpdateFileResponse)
async def update_file_in_sandbox(
    request: UpdateFileRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> UpdateFileResponse:
    try:
        normalized_path = _normalize_file_path(request.file_path)
        await sandbox_service.provider.write_file(
            sandbox_id, normalized_path, request.content
        )
        return UpdateFileResponse(
            success=True, message=f"File {normalized_path} updated successfully"
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/secrets", response_model=SecretsListResponse)
async def get_secrets(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> SecretsListResponse:
    try:
        secrets = await sandbox_service.get_secrets(sandbox_id)
        return SecretsListResponse(secrets=[SecretResponse(**s) for s in secrets])
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/secrets", response_model=MessageResponse)
async def add_secret(
    secret_data: AddSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> MessageResponse:
    try:
        await sandbox_service.provider.add_secret(
            sandbox_id, secret_data.key, secret_data.value
        )
        return MessageResponse(message=f"Secret {secret_data.key} added successfully")
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.put("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def update_secret(
    key: str,
    secret_data: UpdateSecretRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> MessageResponse:
    try:
        await sandbox_service.update_secret(sandbox_id, key, secret_data.value)
        return MessageResponse(message=f"Secret {key} updated successfully")
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.delete("/{sandbox_id}/secrets/{key}", response_model=MessageResponse)
async def delete_secret(
    key: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> MessageResponse:
    try:
        await sandbox_service.provider.delete_secret(sandbox_id, key)
        return MessageResponse(message=f"Secret {key} deleted successfully")
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.put("/{sandbox_id}/ide-theme", response_model=MessageResponse)
async def update_ide_theme(
    request: UpdateIDEThemeRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> MessageResponse:
    try:
        await sandbox_service.update_ide_theme(sandbox_id, request.theme)
        return MessageResponse(message=f"IDE theme updated to {request.theme}")
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/download-zip")
async def download_sandbox_files(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> Response:
    try:
        zip_bytes = await sandbox_service.generate_zip_download(sandbox_id)
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="sandbox_{sandbox_id}.zip"'
            },
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/diff", response_model=GitDiffResponse)
async def get_git_diff(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
    mode: Literal["all", "staged", "unstaged", "branch"] = Query("all"),
    full_context: bool = Query(False),
    cwd: str | None = Query(None),
) -> GitDiffResponse:
    # Workspace is mounted at /home/user/workspace in Docker containers;
    # cd there first, falling back to /home/user for non-Docker sandboxes.
    # When cwd is provided (e.g. a worktree path), cd there instead.
    cd_prefix = _git_cd_prefix(cwd)
    try:
        check = await sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}git rev-parse --is-inside-work-tree 2>/dev/null",
        )
        if check.exit_code != 0:
            return GitDiffResponse(diff="", has_changes=False, is_git_repo=False)

        # Large context window so the patch includes the entire file, enabling full-file diff view
        ctx = " -U99999" if full_context else ""

        untracked_diff = (
            " git ls-files --others --exclude-standard -z"
            f" | xargs -0 -I{{}} git diff{ctx} --no-index -- /dev/null {{}} 2>/dev/null"
        )

        if mode == "branch":
            # Diff current HEAD against the merge-base with the default branch.
            # Detect default branch via the remote HEAD symref, falling back to main/master.
            cmd = (
                "base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/||');"
                " [ -z \"$base\" ] && base=$(git branch -r 2>/dev/null | grep -oE 'origin/(main|master|develop|trunk)' | head -1 | tr -d ' ');"
                ' [ -z "$base" ] && for b in main master develop trunk; do'
                " git rev-parse --verify $b >/dev/null 2>&1 && base=$b && break; done;"
                ' if [ -z "$base" ]; then exit 2; fi;'
                ' merge_base=$(git merge-base "$base" HEAD 2>/dev/null || echo "$base");'
                f' git diff{ctx} "$merge_base" HEAD 2>/dev/null'
            )
        elif mode == "staged":
            cmd = f"git diff{ctx} --cached 2>/dev/null"
        elif mode == "unstaged":
            cmd = f"git diff{ctx} 2>/dev/null;{untracked_diff}"
        else:
            cmd = (
                f"{{ git diff{ctx} HEAD 2>/dev/null"
                f" || {{ git diff{ctx} --cached 2>/dev/null; git diff{ctx} 2>/dev/null; }}; }};"
                f"{untracked_diff}"
            )

        result = await sandbox_service.execute_command(sandbox_id, f"{cd_prefix}{cmd}")
        if mode == "branch" and result.exit_code == 2:
            return GitDiffResponse(
                diff="",
                has_changes=False,
                is_git_repo=True,
                error="Could not determine base branch",
            )
        diff_output = result.stdout
        return GitDiffResponse(
            diff=diff_output,
            has_changes=bool(diff_output.strip()),
            is_git_repo=True,
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/worktrees", response_model=GitWorktreesResponse)
async def get_git_worktrees(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GitWorktreesResponse:
    try:
        result = await sandbox_service.execute_command(
            sandbox_id,
            f"{GIT_CD_PREFIX}git worktree list --porcelain 2>/dev/null",
        )
        if result.exit_code != 0:
            return GitWorktreesResponse(worktrees=[])

        worktrees: list[GitWorktree] = []
        path: str | None = None
        branch: str | None = None

        for line in [*result.stdout.splitlines(), ""]:
            if line.startswith("worktree "):
                path = line[9:]
            elif line.startswith("branch "):
                branch = line[7:].removeprefix("refs/heads/")
            elif line == "" and path:
                worktrees.append(
                    GitWorktree(
                        path=path,
                        branch=branch,
                        is_main=path == SANDBOX_WORKSPACE_DIR,
                    )
                )
                path = None
                branch = None

        return GitWorktreesResponse(worktrees=worktrees)
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/{sandbox_id}/git/branches", response_model=GitBranchesResponse)
async def get_git_branches(
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GitBranchesResponse:
    try:
        check = await sandbox_service.execute_command(
            sandbox_id,
            f"{GIT_CD_PREFIX}git rev-parse --is-inside-work-tree 2>/dev/null",
        )
        if check.exit_code != 0:
            return GitBranchesResponse(
                branches=[], current_branch="", is_git_repo=False
            )

        head_result, local_result, remote_result = await asyncio.gather(
            sandbox_service.execute_command(
                sandbox_id,
                f"{GIT_CD_PREFIX}git rev-parse --abbrev-ref HEAD 2>/dev/null",
            ),
            sandbox_service.execute_command(
                sandbox_id,
                f"{GIT_CD_PREFIX}git branch --no-color 2>/dev/null",
            ),
            sandbox_service.execute_command(
                sandbox_id,
                f"{GIT_CD_PREFIX}git branch -r --no-color 2>/dev/null",
            ),
        )
        current_branch = head_result.stdout.strip()

        local_branches: set[str] = set()
        for line in local_result.stdout.splitlines():
            name = line.removeprefix("* ").strip()
            if name:
                local_branches.add(name)

        all_branches = set(local_branches)
        for line in remote_result.stdout.splitlines():
            name = line.strip()
            if not name or " -> " in name or not name.startswith("origin/"):
                continue
            short = name.removeprefix("origin/")
            if short not in all_branches:
                all_branches.add(short)

        sorted_branches = sorted(all_branches)
        return GitBranchesResponse(
            branches=sorted_branches,
            current_branch=current_branch,
            is_git_repo=True,
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/{sandbox_id}/git/checkout", response_model=GitCheckoutResponse)
async def checkout_git_branch(
    request: GitCheckoutRequest,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> GitCheckoutResponse:
    if (
        not BRANCH_NAME_RE.match(request.branch)
        or ".." in request.branch
        or request.branch.strip(".") == ""
        or request.branch.startswith("-")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid branch name",
        )

    try:
        result = await sandbox_service.execute_command(
            sandbox_id,
            f"{GIT_CD_PREFIX}git checkout '{request.branch}' 2>&1",
        )
        if result.exit_code != 0:
            # Branch might only exist as a remote tracking branch
            result = await sandbox_service.execute_command(
                sandbox_id,
                f"{GIT_CD_PREFIX}git checkout -b '{request.branch}' 'origin/{request.branch}' 2>&1",
            )

        if result.exit_code != 0:
            return GitCheckoutResponse(
                success=False,
                current_branch="",
                error=result.stdout.strip() or result.stderr.strip(),
            )

        head_result = await sandbox_service.execute_command(
            sandbox_id,
            f"{GIT_CD_PREFIX}git rev-parse --abbrev-ref HEAD 2>/dev/null",
        )
        current = head_result.stdout.strip()
        if current == "HEAD":
            # Detached HEAD — revert to previous state
            await sandbox_service.execute_command(
                sandbox_id,
                f"{GIT_CD_PREFIX}git checkout - 2>/dev/null",
            )
            return GitCheckoutResponse(
                success=False,
                current_branch="",
                error="Cannot checkout: would result in detached HEAD",
            )
        return GitCheckoutResponse(
            success=True,
            current_branch=current,
        )
    except SandboxException as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
