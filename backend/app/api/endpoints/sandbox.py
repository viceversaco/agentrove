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
    GitDiffResponse,
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


@router.get(
    "/{sandbox_id}/files/content/{file_path:path}", response_model=FileContentResponse
)
async def get_file_content(
    file_path: str,
    sandbox_id: str = Depends(validate_sandbox_ownership),
    sandbox_service: SandboxService = Depends(get_sandbox_service),
) -> FileContentResponse:
    try:
        file_data = await sandbox_service.get_file_content(sandbox_id, file_path)
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
        await sandbox_service.provider.write_file(
            sandbox_id, request.file_path, request.content
        )
        return UpdateFileResponse(
            success=True, message=f"File {request.file_path} updated successfully"
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
) -> GitDiffResponse:
    # Workspace is mounted at /home/user/workspace in Docker containers;
    # cd there first, falling back to /home/user for non-Docker sandboxes.
    cd_prefix = f"cd {SANDBOX_WORKSPACE_DIR} 2>/dev/null || cd {SANDBOX_HOME_DIR}; "
    try:
        check = await sandbox_service.execute_command(
            sandbox_id,
            f"{cd_prefix}git rev-parse --is-inside-work-tree 2>/dev/null",
        )
        if check.exit_code != 0:
            return GitDiffResponse(diff="", has_changes=False, is_git_repo=False)

        untracked_diff = (
            " git ls-files --others --exclude-standard -z"
            " | xargs -0 -I{} git diff --no-index -- /dev/null {} 2>/dev/null"
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
                ' git diff "$merge_base" HEAD 2>/dev/null'
            )
        elif mode == "staged":
            cmd = "git diff --cached 2>/dev/null"
        elif mode == "unstaged":
            cmd = f"git diff 2>/dev/null;{untracked_diff}"
        else:
            cmd = (
                "{ git diff HEAD 2>/dev/null"
                " || { git diff --cached 2>/dev/null; git diff 2>/dev/null; }; };"
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
