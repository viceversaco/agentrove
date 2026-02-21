from __future__ import annotations

import io

from httpx import AsyncClient

from app.models.db_models.user import User


class TestUploadAgent:
    async def test_upload_agent(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        agent_content = """---
name: test-agent
description: Test integration agent
allowed_tools: []
model: inherit
---
You are a test agent for integration testing.
"""
        file = io.BytesIO(agent_content.encode())

        response = await async_client.post(
            "/api/v1/agents/upload",
            files={"file": ("test-agent.md", file, "text/markdown")},
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "test-agent"
        assert data["description"] == "Test integration agent"
        assert data["enabled"] is True

    async def test_upload_agent_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        agent_content = "Test content"
        file = io.BytesIO(agent_content.encode())

        response = await async_client.post(
            "/api/v1/agents/upload",
            files={"file": ("test.md", file, "text/markdown")},
        )

        assert response.status_code == 401


class TestUpdateAgent:
    async def test_update_agent(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        agent_content = """---
name: update-test-agent
description: Original agent
allowed_tools: []
model: inherit
---
Original content.
"""
        file = io.BytesIO(agent_content.encode())

        upload_response = await async_client.post(
            "/api/v1/agents/upload",
            files={"file": ("update-test-agent.md", file, "text/markdown")},
            headers=auth_headers,
        )
        assert upload_response.status_code == 201

        updated_content = """---
name: update-test-agent
description: Updated agent
allowed_tools: []
model: inherit
---
Updated content.
"""
        response = await async_client.put(
            "/api/v1/agents/update-test-agent",
            json={"content": updated_content},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["description"] == "Updated agent"

    async def test_update_nonexistent_agent(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.put(
            "/api/v1/agents/nonexistent-agent",
            json={"content": "test"},
            headers=auth_headers,
        )

        assert response.status_code == 404

    async def test_update_agent_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.put(
            "/api/v1/agents/test-agent",
            json={"content": "test"},
        )

        assert response.status_code == 401


class TestDeleteAgent:
    async def test_delete_agent(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        agent_content = """---
name: delete-test-agent
description: Agent to delete
allowed_tools: []
model: inherit
---
Content.
"""
        file = io.BytesIO(agent_content.encode())

        upload_response = await async_client.post(
            "/api/v1/agents/upload",
            files={"file": ("delete-test-agent.md", file, "text/markdown")},
            headers=auth_headers,
        )
        assert upload_response.status_code == 201

        response = await async_client.delete(
            "/api/v1/agents/delete-test-agent",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_delete_nonexistent_agent(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.delete(
            "/api/v1/agents/nonexistent-agent",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "not_found"

    async def test_delete_agent_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.delete("/api/v1/agents/test-agent")

        assert response.status_code == 401
