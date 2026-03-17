import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.config import get_settings
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.filesystem import (
    DirectoryBrowseResponse,
    DirectoryEntry,
)

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


def _allowed_roots() -> list[Path]:
    roots = [Path.home()]
    raw = settings.BROWSE_ROOTS
    if raw:
        for entry in raw.split(","):
            entry = entry.strip()
            if entry:
                resolved = Path(entry).expanduser().resolve()
                if resolved.is_dir():
                    roots.append(resolved)
    return roots


def _is_under_allowed_root(target: Path, roots: list[Path]) -> bool:
    return any(target == root or target.is_relative_to(root) for root in roots)


def _list_directory(target: Path, roots: list[Path]) -> list[DirectoryEntry]:
    entries: list[DirectoryEntry] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: p.name.lower())
    except PermissionError:
        return entries

    for child in children:
        if child.name.startswith("."):
            continue
        try:
            if not child.is_dir():
                continue
            # Skip symlinks that resolve outside allowed roots
            resolved = child.resolve()
            if child.is_symlink() and not _is_under_allowed_root(resolved, roots):
                continue
        except (PermissionError, OSError):
            continue
        entries.append(DirectoryEntry(name=child.name, path=str(child)))
    return entries


@router.get("/browse", response_model=DirectoryBrowseResponse)
async def browse_directory(
    path: str | None = Query(None, max_length=4096),
    current_user: User = Depends(get_current_user),
) -> DirectoryBrowseResponse:
    target = Path(path).expanduser().resolve() if path else Path.home()

    if not target.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Path is not a valid directory",
        )

    roots = _allowed_roots()
    if not _is_under_allowed_root(target, roots):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this directory is not allowed",
        )

    entries = await asyncio.to_thread(_list_directory, target, roots)
    parent_path = target.parent
    parent = (
        str(parent_path)
        if parent_path != target and _is_under_allowed_root(parent_path, roots)
        else None
    )

    return DirectoryBrowseResponse(
        path=str(target),
        parent=parent,
        entries=entries,
    )
