from __future__ import annotations

import io
import zipfile

from httpx import AsyncClient

from app.models.db_models.user import User


def create_skill_zip(skill_name: str, description: str = "Test skill") -> io.BytesIO:
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        skill_md_content = f"""---
name: {skill_name}
description: {description}
---
# {skill_name}

This is a test skill for integration testing.
"""
        zf.writestr("SKILL.md", skill_md_content)
        zf.writestr("main.py", "# Test skill code\nprint('Hello from skill')")

    zip_buffer.seek(0)
    return zip_buffer


class TestUploadSkill:
    async def test_upload_skill(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        skill_zip = create_skill_zip("test-skill", "Test integration skill")

        response = await async_client.post(
            "/api/v1/skills/upload",
            files={"file": ("test-skill.zip", skill_zip, "application/zip")},
            headers=auth_headers,
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "test-skill"
        assert data["description"] == "Test integration skill"
        assert data["enabled"] is True

    async def test_upload_skill_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        skill_zip = create_skill_zip("test-skill")

        response = await async_client.post(
            "/api/v1/skills/upload",
            files={"file": ("test.zip", skill_zip, "application/zip")},
        )

        assert response.status_code == 401


class TestDeleteSkill:
    async def test_delete_skill(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        skill_zip = create_skill_zip("delete-test-skill")

        upload_response = await async_client.post(
            "/api/v1/skills/upload",
            files={"file": ("delete-test-skill.zip", skill_zip, "application/zip")},
            headers=auth_headers,
        )
        assert upload_response.status_code == 201

        response = await async_client.delete(
            "/api/v1/skills/delete-test-skill",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"

    async def test_delete_nonexistent_skill(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.delete(
            "/api/v1/skills/nonexistent-skill",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["status"] == "not_found"

    async def test_delete_skill_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.delete("/api/v1/skills/test-skill")

        assert response.status_code == 401
