from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models.db_models.user import User


class TestGetSettings:
    async def test_get_settings(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.get(
            "/api/v1/settings/",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "custom_instructions" in data
        assert "custom_agents" in data
        assert "custom_skills" in data
        assert "custom_slash_commands" in data

    async def test_get_settings_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get("/api/v1/settings/")

        assert response.status_code == 401


class TestUpdateSettings:
    @pytest.mark.parametrize(
        "payload,expected_key",
        [
            (
                {"custom_instructions": "Always respond in a friendly tone"},
                "custom_instructions",
            ),
            (
                {"sandbox_provider": "host"},
                "sandbox_provider",
            ),
            (
                {"custom_env_vars": [{"key": "MY_VAR", "value": "my_value"}]},
                "custom_env_vars",
            ),
            (
                {
                    "custom_instructions": "Be concise",
                    "github_personal_access_token": "test_token_123",
                },
                "custom_instructions",
            ),
        ],
    )
    async def test_update_settings(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
        payload: dict,
        expected_key: str,
    ) -> None:
        response = await async_client.patch(
            "/api/v1/settings/",
            json=payload,
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data[expected_key] == payload[expected_key]

    async def test_update_settings_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.patch(
            "/api/v1/settings/",
            json={"custom_instructions": "test"},
        )

        assert response.status_code == 401


class TestModelIdPrefixNormalization:
    async def test_openrouter_model_ids_are_prefixed(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.patch(
            "/api/v1/settings/",
            json={
                "custom_providers": [
                    {
                        "id": "test-openrouter",
                        "name": "Test OpenRouter",
                        "provider_type": "openrouter",
                        "auth_token": "test-token",
                        "enabled": True,
                        "models": [
                            {
                                "model_id": "anthropic/claude-4.5-haiku",
                                "name": "Claude 4.5 Haiku",
                                "enabled": True,
                            },
                        ],
                    }
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200

        models_response = await async_client.get(
            "/api/v1/models/", headers=auth_headers
        )
        assert models_response.status_code == 200

        models = models_response.json()
        openrouter_models = [m for m in models if m["provider_id"] == "test-openrouter"]
        model_ids = [m["model_id"].split(":", 1)[1] for m in openrouter_models]
        assert "openrouter/anthropic/claude-4.5-haiku" in model_ids

    async def test_openai_model_ids_are_prefixed(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.patch(
            "/api/v1/settings/",
            json={
                "custom_providers": [
                    {
                        "id": "test-openai",
                        "name": "Test OpenAI",
                        "provider_type": "openai",
                        "auth_token": "test-token",
                        "enabled": True,
                        "models": [
                            {"model_id": "gpt-5.2", "name": "GPT-5.2", "enabled": True},
                        ],
                    }
                ]
            },
            headers=auth_headers,
        )
        assert response.status_code == 200

        models_response = await async_client.get(
            "/api/v1/models/", headers=auth_headers
        )
        assert models_response.status_code == 200

        models = models_response.json()
        openai_models = [m for m in models if m["provider_id"] == "test-openai"]

        model_ids = [m["model_id"].split(":", 1)[1] for m in openai_models]
        assert "openai/gpt-5.2" in model_ids
