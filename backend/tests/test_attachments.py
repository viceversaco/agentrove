from __future__ import annotations

import uuid
from pathlib import Path
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.user import User
from app.models.db_models.enums import MessageRole, MessageStreamStatus
from app.services.sandbox import SandboxService

settings = get_settings()


@pytest_asyncio.fixture
async def attachment_with_file(
    db_session: AsyncSession,
    integration_chat_fixture: tuple[User, Chat, SandboxService],
) -> AsyncGenerator[tuple[MessageAttachment, Path], None]:
    user, chat, _ = integration_chat_fixture

    message = Message(
        id=uuid.uuid4(),
        chat_id=chat.id,
        content_text="Test message with attachment",
        role=MessageRole.USER,
        stream_status=MessageStreamStatus.COMPLETED,
    )
    db_session.add(message)
    await db_session.flush()

    storage_base = Path(settings.STORAGE_PATH).resolve()
    storage_base.mkdir(parents=True, exist_ok=True)

    relative_path = f"attachments/{uuid.uuid4().hex}/test_file.txt"
    file_path = storage_base / relative_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text("Test file content for attachment")

    attachment = MessageAttachment(
        id=uuid.uuid4(),
        message_id=message.id,
        filename="test_file.txt",
        file_path=relative_path,
        file_url=f"/attachments/{uuid.uuid4()}/preview",
    )
    db_session.add(attachment)
    await db_session.flush()
    await db_session.refresh(attachment)

    yield attachment, file_path

    file_path.unlink(missing_ok=True)
    if file_path.parent.exists():
        try:
            file_path.parent.rmdir()
        except OSError:
            pass


class TestAttachmentAccess:
    @pytest.mark.parametrize(
        "endpoint,content_check",
        [
            ("preview", "text/plain"),
            ("download", "attachment"),
        ],
    )
    async def test_attachment_success(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
        attachment_with_file: tuple[MessageAttachment, Path],
        endpoint: str,
        content_check: str,
    ) -> None:
        attachment, _ = attachment_with_file

        response = await async_client.get(
            f"/api/v1/attachments/{attachment.id}/{endpoint}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        if endpoint == "preview":
            assert content_check in response.headers.get("content-type", "")
        else:
            assert content_check in response.headers.get("content-disposition", "")
        assert response.text == "Test file content for attachment"

    @pytest.mark.parametrize("endpoint", ["preview", "download"])
    async def test_attachment_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
        endpoint: str,
    ) -> None:
        fake_attachment_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/attachments/{fake_attachment_id}/{endpoint}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.parametrize("endpoint", ["preview", "download"])
    async def test_attachment_unauthorized(
        self,
        async_client: AsyncClient,
        endpoint: str,
    ) -> None:
        fake_attachment_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/attachments/{fake_attachment_id}/{endpoint}",
        )

        assert response.status_code == 401

    async def test_temp_preview_rejects_prefix_bypass_path(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        storage_base = Path(settings.STORAGE_PATH).resolve()
        sibling_storage = storage_base.parent / f"{storage_base.name}_evil"
        sibling_storage.mkdir(parents=True, exist_ok=True)

        escaped_file = sibling_storage / "escape.txt"
        escaped_file.write_text("forbidden")

        try:
            bypass_path = f"../{sibling_storage.name}/escape.txt"
            response = await async_client.get(
                "/api/v1/attachments/temp/preview",
                params={"path": bypass_path},
                headers=auth_headers,
            )

            assert response.status_code == 403
        finally:
            escaped_file.unlink(missing_ok=True)
            try:
                sibling_storage.rmdir()
            except OSError:
                pass
