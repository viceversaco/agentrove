from __future__ import annotations

import io
import json
import uuid
import zipfile

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.db_models.chat import Chat, Message, MessageAttachment
from app.models.db_models.user import User
from app.models.db_models.enums import AttachmentType, MessageRole, MessageStreamStatus
from app.services.sandbox import SandboxService
from tests.conftest import (
    STREAMING_TEST_TIMEOUT,
    read_sandbox_file,
    sandbox_file_exists,
)


class TestCreateChat:
    async def test_create_chat(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Test Chat", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Test Chat"
        assert "id" in data
        assert uuid.UUID(data["id"])
        assert data["user_id"] == str(integration_user_fixture.id)
        assert "sandbox_id" in data
        assert "created_at" in data

    async def test_create_chat_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Test", "model_id": "anthropic:claude-haiku-4-5"},
        )

        assert response.status_code == 401


class TestGetChats:
    async def test_get_chats(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.get(
            "/api/v1/chat/chats",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "per_page" in data
        assert isinstance(data["items"], list)
        assert data["total"] >= 1

    async def test_get_chats_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get("/api/v1/chat/chats")

        assert response.status_code == 401


class TestGetChatDetail:
    async def test_get_chat_detail(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(chat.id)
        assert data["title"] == chat.title
        assert "sandbox_id" in data
        assert "created_at" in data

    async def test_get_chat_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/chat/chats/{fake_id}",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestUpdateChat:
    async def test_update_chat(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        new_title = "Updated Chat Title"

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}",
            json={"title": new_title},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == new_title
        assert data["id"] == str(chat.id)

    async def test_update_chat_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.patch(
            f"/api/v1/chat/chats/{fake_id}",
            json={"title": "New Title"},
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestPinChat:
    async def test_pin_chat(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}",
            json={"pinned": True},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(chat.id)
        assert data["pinned_at"] is not None

    async def test_unpin_chat(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}",
            json={"pinned": True},
            headers=auth_headers,
        )

        response = await async_client.patch(
            f"/api/v1/chat/chats/{chat.id}",
            json={"pinned": False},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(chat.id)
        assert data["pinned_at"] is None

    async def test_pinned_chats_appear_first(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        chat1_response = await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Chat 1", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )
        chat1_id = chat1_response.json()["id"]

        await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Chat 2", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )

        await async_client.patch(
            f"/api/v1/chat/chats/{chat1_id}",
            json={"pinned": True},
            headers=auth_headers,
        )

        list_response = await async_client.get(
            "/api/v1/chat/chats",
            headers=auth_headers,
        )

        assert list_response.status_code == 200
        items = list_response.json()["items"]

        pinned_indices = [i for i, c in enumerate(items) if c.get("pinned_at")]
        unpinned_indices = [i for i, c in enumerate(items) if not c.get("pinned_at")]

        if pinned_indices and unpinned_indices:
            assert max(pinned_indices) < min(unpinned_indices)

    async def test_pin_chat_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.patch(
            f"/api/v1/chat/chats/{fake_id}",
            json={"pinned": True},
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestDeleteChat:
    async def test_delete_chat(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        create_response = await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Chat to Delete", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )
        chat_id = create_response.json()["id"]

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat_id}",
            headers=auth_headers,
        )

        assert response.status_code == 204

        get_response = await async_client.get(
            f"/api/v1/chat/chats/{chat_id}",
            headers=auth_headers,
        )
        assert get_response.status_code == 404


class TestDeleteAllChats:
    async def test_delete_all_chats(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Chat 1", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )
        await async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Chat 2", "model_id": "anthropic:claude-haiku-4-5"},
            headers=auth_headers,
        )

        response = await async_client.delete(
            "/api/v1/chat/chats/all",
            headers=auth_headers,
        )

        assert response.status_code == 204

        list_response = await async_client.get(
            "/api/v1/chat/chats",
            headers=auth_headers,
        )
        assert list_response.json()["total"] == 0


class TestGetMessages:
    async def test_get_messages(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/messages",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "next_cursor" in data
        assert "has_more" in data
        assert isinstance(data["items"], list)


class TestContextUsage:
    async def test_get_context_usage(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.get(
            f"/api/v1/chat/chats/{chat.id}/context-usage",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "tokens_used" in data
        assert "context_window" in data
        assert "percentage" in data
        assert isinstance(data["tokens_used"], int)
        assert isinstance(data["context_window"], int)
        assert 0 <= data["percentage"] <= 100


class TestChatCompletion:
    @pytest.mark.timeout(STREAMING_TEST_TIMEOUT)
    async def test_chat_completion_flow(
        self,
        streaming_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        test_prompt = "Reply with only the word 'hello'"

        completion_response = await streaming_client.post(
            "/api/v1/chat/chat",
            data={
                "prompt": test_prompt,
                "chat_id": str(chat.id),
                "model_id": "anthropic:claude-haiku-4-5",
                "permission_mode": "auto",
            },
            headers=auth_headers,
        )

        assert completion_response.status_code == 200
        completion_data = completion_response.json()
        assert "chat_id" in completion_data
        assert completion_data["chat_id"] == str(chat.id)
        assert "message_id" in completion_data
        assert uuid.UUID(completion_data["message_id"])

        stream_response = await streaming_client.get(
            f"/api/v1/chat/chats/{chat.id}/stream",
            headers=auth_headers,
        )

        assert stream_response.status_code == 200
        assert "text/event-stream" in stream_response.headers.get("content-type", "")

        events = []
        for line in stream_response.text.split("\n"):
            if line.startswith("data:"):
                data = line[5:].strip()
                if data:
                    events.append(data)

        assert len(events) > 0
        has_text_event = any("assistant_text" in str(e) for e in events)
        assert has_text_event

        status_response = await streaming_client.get(
            f"/api/v1/chat/chats/{chat.id}/status",
            headers=auth_headers,
        )

        assert status_response.status_code == 200
        status_data = status_response.json()
        assert "has_active_task" in status_data

        messages_response = await streaming_client.get(
            f"/api/v1/chat/chats/{chat.id}/messages",
            headers=auth_headers,
        )

        assert messages_response.status_code == 200
        messages_data = messages_response.json()
        assert "items" in messages_data
        assert "has_more" in messages_data

        items = messages_data["items"]
        assert len(items) >= 2
        user_messages = [m for m in items if m["role"] == "user"]
        assistant_messages = [m for m in items if m["role"] == "assistant"]

        assert len(user_messages) >= 1
        assert len(assistant_messages) >= 1
        assert test_prompt in user_messages[-1]["content_text"]

        usage_response = await streaming_client.get(
            f"/api/v1/chat/chats/{chat.id}/context-usage",
            headers=auth_headers,
        )

        assert usage_response.status_code == 200
        usage_data = usage_response.json()
        assert usage_data["tokens_used"] > 0

    @pytest.mark.timeout(STREAMING_TEST_TIMEOUT)
    async def test_chat_completion_includes_prompt_suggestions(
        self,
        streaming_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture
        test_prompt = "What is 2 + 2?"

        completion_response = await streaming_client.post(
            "/api/v1/chat/chat",
            data={
                "prompt": test_prompt,
                "chat_id": str(chat.id),
                "model_id": "anthropic:claude-haiku-4-5",
                "permission_mode": "auto",
            },
            headers=auth_headers,
        )

        assert completion_response.status_code == 200

        stream_response = await streaming_client.get(
            f"/api/v1/chat/chats/{chat.id}/stream",
            headers=auth_headers,
        )

        assert stream_response.status_code == 200

        events = []
        for line in stream_response.text.split("\n"):
            if line.startswith("data:"):
                data = line[5:].strip()
                if data:
                    events.append(data)

        has_suggestions_event = any("prompt_suggestions" in str(e) for e in events)
        assert has_suggestions_event, "Expected prompt_suggestions event in stream"

    async def test_chat_completion_requires_chat_id(
        self,
        streaming_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = await streaming_client.post(
            "/api/v1/chat/chat",
            data={
                "prompt": "Hello",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code == 422

    async def test_chat_completion_unauthorized(
        self,
        streaming_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await streaming_client.post(
            "/api/v1/chat/chat",
            data={
                "prompt": "Hello",
                "chat_id": str(chat.id),
                "model_id": "anthropic:claude-haiku-4-5",
            },
        )

        assert response.status_code == 401


class TestEnhancePrompt:
    @pytest.mark.timeout(STREAMING_TEST_TIMEOUT)
    async def test_enhance_prompt(
        self,
        streaming_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await streaming_client.post(
            "/api/v1/chat/enhance-prompt",
            data={
                "prompt": "make a website",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "enhanced_prompt" in data
        assert len(data["enhanced_prompt"]) > len("make a website")

    async def test_enhance_prompt_empty(
        self,
        streaming_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = await streaming_client.post(
            "/api/v1/chat/enhance-prompt",
            data={
                "prompt": "",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code in [400, 422]


class TestStopStream:
    async def test_stop_stream(
        self,
        async_client: AsyncClient,
        integration_chat_fixture: tuple[User, Chat, SandboxService],
        auth_headers: dict[str, str],
    ) -> None:
        _, chat, _ = integration_chat_fixture

        response = await async_client.delete(
            f"/api/v1/chat/chats/{chat.id}/stream",
            headers=auth_headers,
        )

        assert response.status_code == 204

    async def test_stop_stream_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.delete(
            f"/api/v1/chat/chats/{fake_id}/stream",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestChatUnauthorized:
    @pytest.mark.parametrize(
        "method,endpoint_template",
        [
            ("GET", "/api/v1/chat/chats/{chat_id}"),
            ("PATCH", "/api/v1/chat/chats/{chat_id}"),
            ("DELETE", "/api/v1/chat/chats/{chat_id}"),
            ("GET", "/api/v1/chat/chats/{chat_id}/messages"),
            ("GET", "/api/v1/chat/chats/{chat_id}/context-usage"),
            ("GET", "/api/v1/chat/chats/{chat_id}/stream"),
            ("GET", "/api/v1/chat/chats/{chat_id}/status"),
            ("DELETE", "/api/v1/chat/chats/{chat_id}/stream"),
            ("DELETE", "/api/v1/chat/chats/all"),
        ],
    )
    async def test_chat_endpoints_unauthorized(
        self,
        async_client: AsyncClient,
        method: str,
        endpoint_template: str,
    ) -> None:
        fake_id = str(uuid.uuid4())
        endpoint = endpoint_template.format(chat_id=fake_id)

        if method == "GET":
            response = await async_client.get(endpoint)
        elif method == "PATCH":
            response = await async_client.patch(endpoint, json={"title": "test"})
        elif method == "DELETE":
            response = await async_client.delete(endpoint)
        else:
            response = await async_client.request(method, endpoint)

        assert response.status_code == 401

    async def test_enhance_prompt_unauthorized(
        self,
        streaming_client: AsyncClient,
    ) -> None:
        response = await streaming_client.post(
            "/api/v1/chat/enhance-prompt",
            data={"prompt": "test", "model_id": "anthropic:claude-haiku-4-5"},
        )

        assert response.status_code == 401


class TestChatNotFound:
    @pytest.mark.parametrize(
        "endpoint_suffix,expected_status",
        [
            ("/messages", 403),
            ("/context-usage", 404),
            ("/stream", 404),
            ("/status", 404),
        ],
    )
    async def test_chat_endpoints_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
        endpoint_suffix: str,
        expected_status: int,
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/v1/chat/chats/{fake_id}{endpoint_suffix}",
            headers=auth_headers,
        )

        assert response.status_code == expected_status

    async def test_delete_chat_not_found(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await async_client.delete(
            f"/api/v1/chat/chats/{fake_id}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    async def test_chat_completion_invalid_chat(
        self,
        streaming_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        fake_id = str(uuid.uuid4())

        response = await streaming_client.post(
            "/api/v1/chat/chat",
            data={
                "prompt": "Hello",
                "chat_id": fake_id,
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=auth_headers,
        )

        assert response.status_code == 400


class TestForkChat:
    async def test_fork_chat_success(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user, chat, sandbox_service = docker_integration_chat_fixture

        test_file_path = "/home/user/fork_test.txt"
        test_content = "Fork test content"
        await sandbox_service.provider.write_file(
            chat.sandbox_id, test_file_path, test_content
        )

        msg_with_attachment = Message(
            id=uuid.uuid4(),
            chat_id=chat.id,
            content_text="First user message",
            role=MessageRole.USER,
            stream_status=MessageStreamStatus.COMPLETED,
            model_id="anthropic:claude-haiku-4-5",
        )
        messages = [
            msg_with_attachment,
            Message(
                id=uuid.uuid4(),
                chat_id=chat.id,
                content_text="Assistant response",
                role=MessageRole.ASSISTANT,
                stream_status=MessageStreamStatus.COMPLETED,
                model_id="anthropic:claude-haiku-4-5",
                total_cost_usd=0.001,
            ),
            Message(
                id=uuid.uuid4(),
                chat_id=chat.id,
                content_text="Second user message - fork point",
                role=MessageRole.USER,
                stream_status=MessageStreamStatus.COMPLETED,
            ),
            Message(
                id=uuid.uuid4(),
                chat_id=chat.id,
                content_text="Message after fork point - should be excluded",
                role=MessageRole.ASSISTANT,
                stream_status=MessageStreamStatus.COMPLETED,
            ),
        ]
        for msg in messages:
            db_session.add(msg)
        await db_session.flush()

        attachment = MessageAttachment(
            message_id=msg_with_attachment.id,
            file_url="",
            file_path="/home/user/test.png",
            file_type=AttachmentType.IMAGE,
            filename="test.png",
        )
        db_session.add(attachment)
        await db_session.flush()
        attachment.file_url = f"/api/v1/attachments/{attachment.id}/preview"

        fork_point_message = messages[2]
        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{chat.id}/fork",
            json={"message_id": str(fork_point_message.id)},
            headers=docker_auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["messages_copied"] == 3
        assert data["chat"]["title"].startswith("Fork of")
        assert data["chat"]["sandbox_id"] != chat.sandbox_id
        assert data["chat"]["user_id"] == str(user.id)

        new_sandbox_id = data["chat"]["sandbox_id"]
        file_content = await sandbox_service.provider.read_file(
            new_sandbox_id, test_file_path
        )
        assert file_content.content == test_content

        new_chat_id = data["chat"]["id"]
        messages_response = await docker_async_client.get(
            f"/api/v1/chat/chats/{new_chat_id}/messages",
            headers=docker_auth_headers,
        )
        copied_messages = messages_response.json()["items"]

        assert len(copied_messages) == 3
        contents = [m["content_text"] for m in copied_messages]
        assert "First user message" in contents
        assert "Assistant response" in contents
        assert "Second user message - fork point" in contents
        assert "Message after fork point - should be excluded" not in contents

        assistant_msg = next(m for m in copied_messages if m["role"] == "assistant")
        assert assistant_msg["model_id"] == "anthropic:claude-haiku-4-5"

        first_msg = next(
            m for m in copied_messages if m["content_text"] == "First user message"
        )
        assert len(first_msg["attachments"]) == 1
        assert first_msg["attachments"][0]["filename"] == "test.png"
        assert first_msg["attachments"][0]["file_url"] != attachment.file_url

    async def test_fork_chat_not_found_and_access_errors(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_integration_user_fixture: User,
        docker_auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user, chat, _ = docker_integration_chat_fixture

        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{chat.id}/fork",
            json={"message_id": str(uuid.uuid4())},
            headers=docker_auth_headers,
        )
        assert response.status_code == 404

        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{uuid.uuid4()}/fork",
            json={"message_id": str(uuid.uuid4())},
            headers=docker_auth_headers,
        )
        assert response.status_code == 404

        other_chat = Chat(
            id=uuid.uuid4(),
            title="Other chat",
            user_id=docker_integration_user_fixture.id,
            sandbox_id="other-sandbox",
        )
        db_session.add(other_chat)
        await db_session.flush()

        other_message = Message(
            id=uuid.uuid4(),
            chat_id=other_chat.id,
            content_text="Message from other chat",
            role=MessageRole.USER,
            stream_status=MessageStreamStatus.COMPLETED,
        )
        db_session.add(other_message)
        await db_session.flush()

        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{chat.id}/fork",
            json={"message_id": str(other_message.id)},
            headers=docker_auth_headers,
        )
        assert response.status_code == 404

        another_user = User(
            id=uuid.uuid4(),
            email=f"another_user_{uuid.uuid4().hex[:8]}@example.com",
            username=f"another_user_{uuid.uuid4().hex[:8]}",
            hashed_password=get_password_hash("testpassword"),
            is_active=True,
            is_verified=True,
        )
        db_session.add(another_user)
        await db_session.flush()

        another_users_chat = Chat(
            id=uuid.uuid4(),
            title="Another user's chat",
            user_id=another_user.id,
            sandbox_id="another-sandbox",
        )
        db_session.add(another_users_chat)
        await db_session.flush()

        another_users_message = Message(
            id=uuid.uuid4(),
            chat_id=another_users_chat.id,
            content_text="Another user's message",
            role=MessageRole.USER,
            stream_status=MessageStreamStatus.COMPLETED,
        )
        db_session.add(another_users_message)
        await db_session.flush()

        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{another_users_chat.id}/fork",
            json={"message_id": str(another_users_message.id)},
            headers=docker_auth_headers,
        )
        assert response.status_code == 404

    async def test_fork_chat_unauthorized(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
    ) -> None:
        _, chat, _ = docker_integration_chat_fixture

        response = await docker_async_client.post(
            f"/api/v1/chat/chats/{chat.id}/fork",
            json={"message_id": str(uuid.uuid4())},
        )
        assert response.status_code == 401


class TestChatCreationSandboxState:
    async def test_create_chat_with_auto_compact_disabled_sets_claude_json(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
    ) -> None:
        _, _, sandbox_service = docker_integration_chat_fixture

        await docker_async_client.patch(
            "/api/v1/settings/",
            json={"auto_compact_disabled": True},
            headers=docker_auth_headers,
        )

        response = await docker_async_client.post(
            "/api/v1/chat/chats",
            json={
                "title": "Auto Compact Test Chat",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=docker_auth_headers,
        )
        assert response.status_code == 201
        chat_data = response.json()
        sandbox_id = chat_data["sandbox_id"]

        content = await read_sandbox_file(
            sandbox_service, sandbox_id, "/home/user/.claude.json"
        )
        assert content is not None
        config = json.loads(content)
        assert config["autoCompactEnabled"] is False

    async def test_create_chat_with_enabled_agent_copies_to_sandbox(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
    ) -> None:
        _, _, sandbox_service = docker_integration_chat_fixture

        agent_content = """---
name: chat-test-agent
description: Test agent for chat creation
allowed_tools: []
model: inherit
---
You are a chat test agent."""

        file = io.BytesIO(agent_content.encode())
        upload_response = await docker_async_client.post(
            "/api/v1/agents/upload",
            files={"file": ("chat-test-agent.md", file, "text/markdown")},
            headers=docker_auth_headers,
        )
        assert upload_response.status_code == 201

        await docker_async_client.patch(
            "/api/v1/settings/",
            json={"custom_agents": [{"name": "chat-test-agent", "enabled": True}]},
            headers=docker_auth_headers,
        )

        response = await docker_async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Agent Test Chat", "model_id": "anthropic:claude-haiku-4-5"},
            headers=docker_auth_headers,
        )
        assert response.status_code == 201
        chat_data = response.json()
        sandbox_id = chat_data["sandbox_id"]

        agent_path = "/home/user/.claude/agents/chat-test-agent.md"
        exists = await sandbox_file_exists(sandbox_service, sandbox_id, agent_path)
        assert exists is True

        content = await read_sandbox_file(sandbox_service, sandbox_id, agent_path)
        assert content is not None
        assert "chat-test-agent" in content

    async def test_create_chat_with_env_vars_sets_secrets(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
    ) -> None:
        _, _, sandbox_service = docker_integration_chat_fixture

        await docker_async_client.patch(
            "/api/v1/settings/",
            json={
                "custom_env_vars": [
                    {"key": "CHAT_TEST_VAR", "value": "chat_test_value"}
                ]
            },
            headers=docker_auth_headers,
        )

        response = await docker_async_client.post(
            "/api/v1/chat/chats",
            json={
                "title": "Env Vars Test Chat",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=docker_auth_headers,
        )
        assert response.status_code == 201
        chat_data = response.json()
        sandbox_id = chat_data["sandbox_id"]

        secrets = await sandbox_service.get_secrets(sandbox_id)
        secret_dict = {s["key"]: s["value"] for s in secrets}

        assert "CHAT_TEST_VAR" in secret_dict
        assert secret_dict["CHAT_TEST_VAR"] == "chat_test_value"

    async def test_create_chat_with_enabled_skill_copies_to_sandbox(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
    ) -> None:
        _, _, sandbox_service = docker_integration_chat_fixture

        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            skill_md = """---
name: chat-test-skill
description: Test skill for chat creation
---
# Chat Test Skill
This is a test skill for chat creation."""
            zf.writestr("SKILL.md", skill_md)
            zf.writestr("main.py", "print('Hello from chat skill')")
        zip_buffer.seek(0)

        upload_response = await docker_async_client.post(
            "/api/v1/skills/upload",
            files={"file": ("chat-test-skill.zip", zip_buffer, "application/zip")},
            headers=docker_auth_headers,
        )
        assert upload_response.status_code == 201

        await docker_async_client.patch(
            "/api/v1/settings/",
            json={"custom_skills": [{"name": "chat-test-skill", "enabled": True}]},
            headers=docker_auth_headers,
        )

        response = await docker_async_client.post(
            "/api/v1/chat/chats",
            json={"title": "Skill Test Chat", "model_id": "anthropic:claude-haiku-4-5"},
            headers=docker_auth_headers,
        )
        assert response.status_code == 201
        chat_data = response.json()
        sandbox_id = chat_data["sandbox_id"]

        skill_path = "/home/user/.claude/skills/chat-test-skill/SKILL.md"
        exists = await sandbox_file_exists(sandbox_service, sandbox_id, skill_path)
        assert exists is True

        content = await read_sandbox_file(sandbox_service, sandbox_id, skill_path)
        assert content is not None
        assert "chat-test-skill" in content

    async def test_create_chat_with_enabled_command_copies_to_sandbox(
        self,
        docker_async_client: AsyncClient,
        docker_integration_chat_fixture: tuple[User, Chat, SandboxService],
        docker_auth_headers: dict[str, str],
    ) -> None:
        _, _, sandbox_service = docker_integration_chat_fixture

        command_content = """---
name: chat-test-command
description: Test command for chat creation
argument_hint: <test_arg>
allowed_tools: []
model: null
---
Execute the chat test command."""

        file = io.BytesIO(command_content.encode())
        upload_response = await docker_async_client.post(
            "/api/v1/commands/upload",
            files={"file": ("chat-test-command.md", file, "text/markdown")},
            headers=docker_auth_headers,
        )
        assert upload_response.status_code == 201

        await docker_async_client.patch(
            "/api/v1/settings/",
            json={
                "custom_slash_commands": [
                    {"name": "chat-test-command", "enabled": True}
                ]
            },
            headers=docker_auth_headers,
        )

        response = await docker_async_client.post(
            "/api/v1/chat/chats",
            json={
                "title": "Command Test Chat",
                "model_id": "anthropic:claude-haiku-4-5",
            },
            headers=docker_auth_headers,
        )
        assert response.status_code == 201
        chat_data = response.json()
        sandbox_id = chat_data["sandbox_id"]

        command_path = "/home/user/.claude/commands/chat-test-command.md"
        exists = await sandbox_file_exists(sandbox_service, sandbox_id, command_path)
        assert exists is True

        content = await read_sandbox_file(sandbox_service, sandbox_id, command_path)
        assert content is not None
        assert "chat-test-command" in content
