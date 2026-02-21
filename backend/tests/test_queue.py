from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.models.db_models.chat import Chat
from app.models.db_models.user import User
from app.services.sandbox import SandboxService


class TestQueueMessage:
    async def test_queue_message(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Test queued message",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert "id" in data
        assert uuid.UUID(data["id"])
        assert "queued_at" in data

    async def test_queue_multiple_messages(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        resp1 = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "First message",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )
        assert resp1.status_code == 201
        id1 = resp1.json()["id"]

        resp2 = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Second message",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )
        assert resp2.status_code == 201
        id2 = resp2.json()["id"]
        assert id1 != id2

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )
        queue = get_response.json()
        assert len(queue) == 2
        assert queue[0]["content"] == "First message"
        assert queue[1]["content"] == "Second message"

    async def test_queue_message_with_options(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Message with options",
                "model_id": "claude-haiku-4-5",
                "permission_mode": "plan",
                "thinking_mode": "extended",
            },
            headers=auth_headers,
        )

        assert response.status_code == 201

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )

        queue = get_response.json()
        assert len(queue) == 1
        assert queue[0]["permission_mode"] == "plan"
        assert queue[0]["thinking_mode"] == "extended"

    async def test_queue_message_chat_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_chat_id = uuid.uuid4()

        response = await async_client.post(
            f"/api/v1/chat/chats/{fake_chat_id}/queue",
            data={
                "content": "Test message",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code == 404

    async def test_queue_message_unauthorized(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Test message",
                "model_id": "claude-haiku-4-5",
            },
        )

        assert response.status_code == 401


class TestGetQueue:
    async def test_get_queue(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Queued content",
                "model_id": "claude-haiku-4-5",
                "permission_mode": "plan",
            },
            headers=auth_headers,
        )

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )

        assert response.status_code == 200
        queue = response.json()
        assert len(queue) == 1
        assert queue[0]["content"] == "Queued content"
        assert queue[0]["model_id"] == "claude-haiku-4-5"
        assert queue[0]["permission_mode"] == "plan"
        assert "id" in queue[0]
        assert "queued_at" in queue[0]

    async def test_get_queue_empty(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json() == []

    async def test_get_queue_unauthorized(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
        )

        assert response.status_code == 401


class TestUpdateQueuedMessage:
    async def test_update_queued_message(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        post_response = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "Original content",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )
        message_id = post_response.json()["id"]

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}/queue/{message_id}",
            json={"content": "Updated content"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["content"] == "Updated content"

    async def test_update_queued_message_not_found(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        fake_id = uuid.uuid4()

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}/queue/{fake_id}",
            json={"content": "Updated content"},
            headers=auth_headers,
        )

        assert response.status_code == 404

    async def test_update_queued_message_unauthorized(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        fake_id = uuid.uuid4()

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}/queue/{fake_id}",
            json={"content": "Updated content"},
        )

        assert response.status_code == 401


class TestDeleteQueuedMessage:
    async def test_delete_queued_message(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        post_response = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "To be deleted",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )
        message_id = post_response.json()["id"]

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue/{message_id}",
            headers=auth_headers,
        )
        assert response.status_code == 204

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )
        assert get_response.json() == []

    async def test_delete_queued_message_not_found(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        fake_id = uuid.uuid4()

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue/{fake_id}",
            headers=auth_headers,
        )
        assert response.status_code == 404

    async def test_delete_one_preserves_others(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        resp1 = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={"content": "Keep me", "model_id": "claude-haiku-4-5"},
            headers=auth_headers,
        )
        resp2 = await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={"content": "Delete me", "model_id": "claude-haiku-4-5"},
            headers=auth_headers,
        )
        delete_id = resp2.json()["id"]
        keep_id = resp1.json()["id"]

        await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue/{delete_id}",
            headers=auth_headers,
        )

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )
        queue = get_response.json()
        assert len(queue) == 1
        assert queue[0]["id"] == keep_id
        assert queue[0]["content"] == "Keep me"


class TestClearQueue:
    async def test_clear_queue(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        await async_client.post(
            f"/api/v1/chat/chats/{chat.id}/queue",
            data={
                "content": "To be cleared",
                "model_id": "claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )

        assert response.status_code == 204

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )
        assert get_response.json() == []

    async def test_clear_empty_queue(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue",
            headers=auth_headers,
        )

        assert response.status_code == 204

    async def test_clear_queue_unauthorized(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/queue",
        )

        assert response.status_code == 401
