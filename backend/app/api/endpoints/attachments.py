import mimetypes
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import get_current_user
from app.core.deps import get_chat_service
from app.db.session import get_db
from app.models.db_models import MessageAttachment, User
from app.services.chat import ChatService

router = APIRouter()
settings = get_settings()


def _is_within_base_path(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def _get_mime_type(file_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(file_path))
    return mime_type or "application/octet-stream"


async def _get_attachment_with_path(
    attachment_id: UUID,
    current_user: User,
    db: AsyncSession,
    chat_service: ChatService,
) -> tuple[MessageAttachment, Path]:
    attachment = await chat_service.message_service.get_attachment(attachment_id, db)

    if not attachment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    if attachment.message.chat.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    storage_base = Path(settings.STORAGE_PATH).resolve()
    file_path = (storage_base / attachment.file_path).resolve()

    if not _is_within_base_path(file_path, storage_base):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    return attachment, file_path


def _build_file_response(
    file_path: Path, filename: str | None, *, inline: bool
) -> FileResponse:
    safe_filename = filename or file_path.name or "file"
    disposition = "inline" if inline else "attachment"

    ascii_filename = safe_filename.encode("ascii", "ignore").decode("ascii") or "file"
    encoded_filename = quote(safe_filename, safe="")

    headers = {
        "Content-Disposition": f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}",
    }
    if inline:
        headers["Cache-Control"] = "private, max-age=3600"

    return FileResponse(
        path=file_path,
        media_type=_get_mime_type(file_path),
        headers=headers,
    )


@router.get("/attachments/temp/preview")
async def preview_temp_attachment(
    path: str,
    current_user: User = Depends(get_current_user),
) -> FileResponse:
    storage_base = Path(settings.STORAGE_PATH).resolve()
    user_temp_base = (storage_base / "temp" / str(current_user.id)).resolve()
    file_path = (storage_base / path).resolve()

    if not _is_within_base_path(file_path, user_temp_base):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File not found"
        )

    return _build_file_response(file_path, file_path.name, inline=True)


@router.get("/attachments/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    chat_service: ChatService = Depends(get_chat_service),
) -> FileResponse:
    attachment, file_path = await _get_attachment_with_path(
        attachment_id, current_user, db, chat_service
    )
    return _build_file_response(file_path, attachment.filename, inline=True)


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    chat_service: ChatService = Depends(get_chat_service),
) -> FileResponse:
    attachment, file_path = await _get_attachment_with_path(
        attachment_id, current_user, db, chat_service
    )
    return _build_file_response(file_path, attachment.filename, inline=False)
