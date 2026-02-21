from __future__ import annotations

import asyncio
import uuid

from httpx import AsyncClient
from redis.asyncio import Redis

from app.core.security import create_chat_scoped_token
from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.services.permission_manager import PermissionManager
from app.services.sandbox import SandboxService


class TestPermissionRequest:
    async def test_permission_request_success(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        redis_client: Redis,
    ) -> None:
        _, chat, _ = integration_chat_fixture
        chat_scoped_token = create_chat_scoped_token(str(chat.id))

        response = await async_client.post(
            f"/api/v1/chats/{chat.id}/permissions/request",
            json={
                "tool_name": "bash",
                "tool_input": {"command": "ls -la"},
            },
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "request_id" in data
        assert uuid.UUID(data["request_id"])

    async def test_permission_request_requires_valid_token(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.post(
            f"/api/v1/chats/{chat.id}/permissions/request",
            json={
                "tool_name": "bash",
                "tool_input": {"command": "ls"},
            },
            headers={"Authorization": "Bearer invalid_token"},
        )

        assert response.status_code == 403

    async def test_permission_request_wrong_chat(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        wrong_chat_id = str(uuid.uuid4())
        chat_scoped_token = create_chat_scoped_token(str(chat.id))

        response = await async_client.post(
            f"/api/v1/chats/{wrong_chat_id}/permissions/request",
            json={
                "tool_name": "bash",
                "tool_input": {"command": "ls"},
            },
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        assert response.status_code == 403

    async def test_permission_request_missing_auth(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.post(
            f"/api/v1/chats/{chat.id}/permissions/request",
            json={
                "tool_name": "bash",
                "tool_input": {"command": "ls"},
            },
        )

        assert response.status_code == 422


class TestPermissionResponse:
    async def test_permission_response_approved(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        redis_client: Redis,
    ) -> None:
        _, chat, _ = integration_chat_fixture
        chat_scoped_token = create_chat_scoped_token(str(chat.id))

        create_response = await async_client.post(
            f"/api/v1/chats/{chat.id}/permissions/request",
            json={
                "tool_name": "file_write",
                "tool_input": {"path": "/test.txt", "content": "test"},
            },
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )
        request_id = create_response.json()["request_id"]

        async def send_approval() -> None:
            await asyncio.sleep(0.1)
            await PermissionManager.respond(request_id, approved=True)

        approval_task = asyncio.create_task(send_approval())

        response = await async_client.get(
            f"/api/v1/chats/{chat.id}/permissions/response/{request_id}",
            params={"timeout": 5},
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        await approval_task

        assert response.status_code == 200
        data = response.json()
        assert data["approved"] is True
        assert data["alternative_instruction"] is None

    async def test_permission_response_denied_with_alternative(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        redis_client: Redis,
    ) -> None:
        _, chat, _ = integration_chat_fixture
        chat_scoped_token = create_chat_scoped_token(str(chat.id))

        create_response = await async_client.post(
            f"/api/v1/chats/{chat.id}/permissions/request",
            json={
                "tool_name": "bash",
                "tool_input": {"command": "rm -rf /"},
            },
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )
        request_id = create_response.json()["request_id"]

        async def send_denial() -> None:
            await asyncio.sleep(0.1)
            await PermissionManager.respond(
                request_id,
                approved=False,
                alternative_instruction="Please use a safer command",
            )

        denial_task = asyncio.create_task(send_denial())

        response = await async_client.get(
            f"/api/v1/chats/{chat.id}/permissions/response/{request_id}",
            params={"timeout": 5},
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        await denial_task

        assert response.status_code == 200
        data = response.json()
        assert data["approved"] is False
        assert data["alternative_instruction"] == "Please use a safer command"

    async def test_permission_response_not_found(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        chat_scoped_token = create_chat_scoped_token(str(chat.id))
        fake_request_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/chats/{chat.id}/permissions/response/{fake_request_id}",
            params={"timeout": 1},
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        assert response.status_code == 404

    async def test_permission_response_invalid_token(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        fake_request_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/chats/{chat.id}/permissions/response/{fake_request_id}",
            headers={"Authorization": "Bearer invalid_token"},
        )

        assert response.status_code == 403

    async def test_permission_response_timeout_bounds(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        chat_scoped_token = create_chat_scoped_token(str(chat.id))
        fake_request_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/chats/{chat.id}/permissions/response/{fake_request_id}",
            params={"timeout": 0},
            headers={"Authorization": f"Bearer {chat_scoped_token}"},
        )

        assert response.status_code == 422
