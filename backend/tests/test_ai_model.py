from __future__ import annotations

from httpx import AsyncClient

from app.models.db_models.user import User


class TestListModels:
    async def test_list_models(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.get("/api/v1/models/", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1

        for model in data:
            assert "model_id" in model
            assert "name" in model
            assert "provider_id" in model
            assert "provider_name" in model
            assert "provider_type" in model
            assert "context_window" in model
            assert ":" in model["model_id"]

    async def test_list_models_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get("/api/v1/models/")

        assert response.status_code == 401
