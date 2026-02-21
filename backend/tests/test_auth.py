from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.db_models import User
from tests.conftest import TEST_PASSWORD


class TestLogin:
    async def test_login_success(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": integration_user_fixture.email,
                "password": TEST_PASSWORD,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert len(data["access_token"]) > 0
        assert len(data["refresh_token"]) > 0

    async def test_login_wrong_password(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": integration_user_fixture.email,
                "password": "wrongpassword",
            },
        )

        assert response.status_code == 400
        assert "Invalid email or password" in response.json()["detail"]

    async def test_login_nonexistent_user(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": "nonexistent@example.com",
                "password": "anypassword",
            },
        )

        assert response.status_code == 400
        assert "Invalid email or password" in response.json()["detail"]

    async def test_login_inactive_account(
        self,
        async_client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        inactive_user = User(
            id=uuid.uuid4(),
            email=f"inactive_{uuid.uuid4().hex[:8]}@example.com",
            username=f"inactive_{uuid.uuid4().hex[:8]}",
            hashed_password=get_password_hash(TEST_PASSWORD),
            is_active=False,
            is_verified=True,
        )
        db_session.add(inactive_user)
        await db_session.flush()

        response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": inactive_user.email,
                "password": TEST_PASSWORD,
            },
        )

        assert response.status_code == 400
        assert "inactive" in response.json()["detail"].lower()


class TestRegister:
    async def test_register_success(
        self,
        async_client: AsyncClient,
    ) -> None:
        unique_email = f"newuser_{uuid.uuid4().hex[:8]}@example.com"
        unique_username = f"newuser_{uuid.uuid4().hex[:8]}"

        response = await async_client.post(
            "/api/v1/auth/register",
            json={
                "email": unique_email,
                "username": unique_username,
                "password": "securepassword123",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["email"] == unique_email
        assert data["username"] == unique_username
        assert "id" in data
        assert uuid.UUID(data["id"])

    async def test_register_duplicate_email(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/register",
            json={
                "email": integration_user_fixture.email,
                "username": f"different_{uuid.uuid4().hex[:8]}",
                "password": "securepassword123",
            },
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()

    async def test_register_duplicate_username(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/register",
            json={
                "email": f"different_{uuid.uuid4().hex[:8]}@example.com",
                "username": integration_user_fixture.username,
                "password": "securepassword123",
            },
        )

        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()


class TestRefreshToken:
    async def test_refresh_token_success(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        login_response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": integration_user_fixture.email,
                "password": TEST_PASSWORD,
            },
        )
        assert login_response.status_code == 200
        refresh_token = login_response.json()["refresh_token"]

        response = await async_client.post(
            "/api/v1/auth/jwt/refresh",
            json={"refresh_token": refresh_token},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["refresh_token"] != refresh_token

    async def test_refresh_token_invalid(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.post(
            "/api/v1/auth/jwt/refresh",
            json={"refresh_token": "invalid_token"},
        )

        assert response.status_code == 401
        assert "Invalid or expired" in response.json()["detail"]


class TestLogout:
    async def test_logout_success(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        login_response = await async_client.post(
            "/api/v1/auth/jwt/login",
            data={
                "username": integration_user_fixture.email,
                "password": TEST_PASSWORD,
            },
        )
        assert login_response.status_code == 200
        refresh_token = login_response.json()["refresh_token"]

        response = await async_client.post(
            "/api/v1/auth/jwt/logout",
            json={"refresh_token": refresh_token},
        )

        assert response.status_code == 204

        reuse_response = await async_client.post(
            "/api/v1/auth/jwt/refresh",
            json={"refresh_token": refresh_token},
        )
        assert reuse_response.status_code == 401


class TestCurrentUser:
    async def test_get_current_user(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.get(
            "/api/v1/auth/me",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == integration_user_fixture.email
        assert data["username"] == integration_user_fixture.username
        assert data["id"] == str(integration_user_fixture.id)


class TestUserUsage:
    async def test_get_user_usage(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.get(
            "/api/v1/auth/usage",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "messages_used_today" in data
        assert isinstance(data["messages_used_today"], int)


class TestUnauthorizedAccess:
    @pytest.mark.parametrize(
        "endpoint",
        [
            "/api/v1/auth/me",
            "/api/v1/auth/usage",
        ],
    )
    async def test_unauthorized_access(
        self,
        async_client: AsyncClient,
        endpoint: str,
    ) -> None:
        response = await async_client.get(endpoint)

        assert response.status_code == 401
