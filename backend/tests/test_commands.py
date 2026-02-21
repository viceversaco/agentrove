from __future__ import annotations

import io

from httpx import AsyncClient

from app.models.db_models.user import User


class TestUploadCommand:
    async def test_upload_command(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        command_content = """---
name: test-command
description: Test integration command
argument_hint: <optional argument>
allowed_tools: []
model: null
---
Execute the test command with the given argument.
"""
        file = io.BytesIO(command_content.encode())

        response = await async_client.post(
            "/api/v1/commands/upload",
            files={"file": ("test-command.md", file, "text/markdown")},
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "test-command"
        assert data["description"] == "Test integration command"
        assert data["enabled"] is True

    async def test_upload_command_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        command_content = "Test content"
        file = io.BytesIO(command_content.encode())

        response = await async_client.post(
            "/api/v1/commands/upload",
            files={"file": ("test.md", file, "text/markdown")},
        )

        assert response.status_code == 401


class TestUpdateCommand:
    async def test_update_command(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        command_content = """---
name: update-test-command
description: Original command
argument_hint: null
allowed_tools: []
model: null
---
Original content.
"""
        file = io.BytesIO(command_content.encode())

        upload_response = await async_client.post(
            "/api/v1/commands/upload",
            files={"file": ("update-test-command.md", file, "text/markdown")},
            headers=auth_headers,
        )
        assert upload_response.status_code == 201

        updated_content = """---
name: update-test-command
description: Updated command
argument_hint: <new hint>
allowed_tools: []
model: null
---
Updated content.
"""
        response = await async_client.put(
            "/api/v1/commands/update-test-command",
            json={"content": updated_content},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["description"] == "Updated command"

    async def test_update_nonexistent_command(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.put(
            "/api/v1/commands/nonexistent-command",
            json={"content": "test"},
            headers=auth_headers,
        )

        assert response.status_code == 404

    async def test_update_command_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.put(
            "/api/v1/commands/test-command",
            json={"content": "test"},
        )

        assert response.status_code == 401


class TestDeleteCommand:
    async def test_delete_command(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        command_content = """---
name: delete-test-command
description: Command to delete
argument_hint: null
allowed_tools: []
model: null
---
Content.
"""
        file = io.BytesIO(command_content.encode())

        upload_response = await async_client.post(
            "/api/v1/commands/upload",
            files={"file": ("delete-test-command.md", file, "text/markdown")},
            headers=auth_headers,
        )
        assert upload_response.status_code == 201

        response = await async_client.delete(
            "/api/v1/commands/delete-test-command",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_delete_nonexistent_command(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.delete(
            "/api/v1/commands/nonexistent-command",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "not_found"

    async def test_delete_command_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.delete("/api/v1/commands/test-command")

        assert response.status_code == 401
