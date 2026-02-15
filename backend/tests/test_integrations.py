from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, HTTPStatusError

from app.models.db_models import User
from app.services import gmail_oauth
from app.services.gmail_oauth import GmailOAuthService

VALID_WEB_OAUTH_CLIENT = {
    "web": {
        "client_id": "test-client-id.apps.googleusercontent.com",
        "client_secret": "test-client-secret",
        "redirect_uris": ["http://localhost:8080/api/v1/integrations/gmail/callback"],
    }
}

VALID_INSTALLED_OAUTH_CLIENT = {
    "installed": {
        "client_id": "test-client-id.apps.googleusercontent.com",
        "client_secret": "test-client-secret",
        "redirect_uris": ["http://localhost"],
    }
}

MOCK_TOKENS_RESPONSE = {
    "access_token": "mock_access_token",
    "refresh_token": "mock_refresh_token",
    "expires_in": 3600,
    "token_type": "Bearer",
}


@pytest.fixture
def mock_base_url():
    with patch.object(gmail_oauth.settings, "BASE_URL", "http://localhost:8080"):
        yield


class TestUploadOAuthClient:
    async def test_upload_oauth_client_success(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "saved" in data["message"].lower()

    async def test_upload_oauth_client_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        assert response.status_code == 401

    async def test_upload_oauth_client_missing_client_id(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        invalid_config = {
            "web": {
                "client_secret": "test-secret",
                "redirect_uris": [
                    "http://localhost:8080/api/v1/integrations/gmail/callback"
                ],
            }
        }

        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": invalid_config},
        )

        assert response.status_code == 400
        assert "client_id" in response.json()["detail"].lower()

    async def test_upload_oauth_client_missing_client_secret(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        invalid_config = {
            "web": {
                "client_id": "test-client-id.apps.googleusercontent.com",
                "redirect_uris": [
                    "http://localhost:8080/api/v1/integrations/gmail/callback"
                ],
            }
        }

        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": invalid_config},
        )

        assert response.status_code == 400
        assert "client_secret" in response.json()["detail"].lower()

    async def test_upload_oauth_client_missing_installed_or_web_key(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        invalid_config = {
            "client_id": "test-client-id.apps.googleusercontent.com",
            "client_secret": "test-secret",
        }

        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": invalid_config},
        )

        assert response.status_code == 400
        assert (
            "installed" in response.json()["detail"].lower()
            or "web" in response.json()["detail"].lower()
        )

    async def test_upload_oauth_client_invalid_redirect_uri(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        invalid_config = {
            "web": {
                "client_id": "test-client-id.apps.googleusercontent.com",
                "client_secret": "test-secret",
                "redirect_uris": ["http://example.com/callback"],
            }
        }

        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": invalid_config},
        )

        assert response.status_code == 400
        assert "redirect_uri" in response.json()["detail"].lower()

    async def test_upload_oauth_client_clears_existing_tokens(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "test@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        assert status_response.json()["connected"] is True

        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )
        assert response.status_code == 200

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        data = status_response.json()
        assert data["connected"] is False
        assert data["email"] is None
        assert data["has_oauth_client"] is True

    async def test_upload_oauth_client_empty_body(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={},
        )

        assert response.status_code == 422

    async def test_upload_oauth_client_installed_type(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        response = await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_INSTALLED_OAUTH_CLIENT},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        assert status_response.json()["has_oauth_client"] is True


class TestDeleteOAuthClient:
    async def test_delete_oauth_client_success(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        response = await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "removed" in data["message"].lower()

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        assert status_response.json()["has_oauth_client"] is False

    async def test_delete_oauth_client_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
        )

        assert response.status_code == 401

    async def test_delete_oauth_client_also_clears_tokens(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "test@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        assert status_response.json()["connected"] is True

        response = await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
        )
        assert response.status_code == 200

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        data = status_response.json()
        assert data["connected"] is False
        assert data["email"] is None
        assert data["has_oauth_client"] is False


class TestGetOAuthUrl:
    async def test_get_oauth_url_success(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        response = await async_client.get(
            "/api/v1/integrations/gmail/oauth-url",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        url = data["url"]

        assert "accounts.google.com" in url
        assert "client_id=" in url
        assert "redirect_uri=" in url
        assert "response_type=code" in url
        assert "scope=" in url
        assert "state=" in url

    async def test_get_oauth_url_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get(
            "/api/v1/integrations/gmail/oauth-url",
        )

        assert response.status_code == 401

    async def test_get_oauth_url_without_client_configured(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
        )

        response = await async_client.get(
            "/api/v1/integrations/gmail/oauth-url",
            headers=auth_headers,
        )

        assert response.status_code == 400
        assert "not configured" in response.json()["detail"].lower()


class TestOAuthCallback:
    async def test_oauth_callback_success(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "test@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            response = await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        assert response.status_code == 200
        assert "Gmail Connected" in response.text
        assert "test@gmail.com" in response.text
        assert "postMessage('gmail-connected', '*')" not in response.text

    async def test_oauth_callback_escapes_email_and_uses_specific_origin(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "<b>xss@example.com</b>"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            response = await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        assert response.status_code == 200
        assert "<b>xss@example.com</b>" not in response.text
        assert "&lt;b&gt;xss@example.com&lt;/b&gt;" in response.text
        assert "postMessage('gmail-connected', '*')" not in response.text

    async def test_oauth_callback_invalid_state(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get(
            "/api/v1/integrations/gmail/callback",
            params={"code": "test_auth_code", "state": "invalid_state_token"},
        )

        assert response.status_code == 400
        assert "Invalid state" in response.text

    async def test_oauth_callback_expired_state(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        from jose import jwt

        from app.core.config import get_settings

        settings = get_settings()
        expired_payload = {
            "user_id": str(integration_user_fixture.id),
            "purpose": "gmail_oauth",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        }
        expired_state = jwt.encode(
            expired_payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM
        )

        response = await async_client.get(
            "/api/v1/integrations/gmail/callback",
            params={"code": "test_auth_code", "state": expired_state},
        )

        assert response.status_code == 400
        assert "Invalid state" in response.text

    async def test_oauth_callback_token_exchange_failure(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.raise_for_status.side_effect = HTTPStatusError(
                "Token exchange failed",
                request=MagicMock(),
                response=MagicMock(status_code=400),
            )
            mock_async_client.post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            response = await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "invalid_code", "state": state},
            )

        assert response.status_code == 500
        assert "Could not exchange" in response.text

    async def test_oauth_callback_missing_code(
        self,
        async_client: AsyncClient,
        integration_user_fixture: User,
    ) -> None:
        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        response = await async_client.get(
            "/api/v1/integrations/gmail/callback",
            params={"state": state},
        )

        assert response.status_code == 422

    async def test_oauth_callback_missing_state(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get(
            "/api/v1/integrations/gmail/callback",
            params={"code": "test_auth_code"},
        )

        assert response.status_code == 422


class TestGetGmailStatus:
    async def test_get_gmail_status_not_connected(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
        )

        response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is False
        assert data["email"] is None
        assert data["connected_at"] is None
        assert data["has_oauth_client"] is False

    async def test_get_gmail_status_with_oauth_client_not_connected(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is False
        assert data["email"] is None
        assert data["has_oauth_client"] is True

    async def test_get_gmail_status_connected(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "connected@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["connected"] is True
        assert data["email"] == "connected@gmail.com"
        assert data["connected_at"] is not None
        assert data["has_oauth_client"] is True

    async def test_get_gmail_status_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.get(
            "/api/v1/integrations/gmail/status",
        )

        assert response.status_code == 401


class TestDisconnectGmail:
    async def test_disconnect_gmail_success(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "test@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        mock_revoke_response = MagicMock()
        mock_revoke_response.status_code = 200

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_revoke_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            response = await async_client.post(
                "/api/v1/integrations/gmail/disconnect",
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "disconnected" in data["message"].lower()

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        status_data = status_response.json()
        assert status_data["connected"] is False
        assert status_data["email"] is None
        assert status_data["has_oauth_client"] is True

    async def test_disconnect_gmail_revoke_failure_still_disconnects(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
        integration_user_fixture: User,
        mock_base_url,
    ) -> None:
        await async_client.post(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
            json={"client_config": VALID_WEB_OAUTH_CLIENT},
        )

        state = GmailOAuthService.create_oauth_state(integration_user_fixture.id)

        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = MOCK_TOKENS_RESPONSE
        mock_token_response.raise_for_status = MagicMock()

        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {"email": "test@gmail.com"}

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_token_response)
            mock_async_client.get = AsyncMock(return_value=mock_userinfo_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            await async_client.get(
                "/api/v1/integrations/gmail/callback",
                params={"code": "test_auth_code", "state": state},
            )

        mock_revoke_response = MagicMock()
        mock_revoke_response.status_code = 400

        with patch("app.services.gmail_oauth.httpx.AsyncClient") as mock_client:
            mock_async_client = AsyncMock()
            mock_async_client.post = AsyncMock(return_value=mock_revoke_response)
            mock_client.return_value.__aenter__.return_value = mock_async_client

            response = await async_client.post(
                "/api/v1/integrations/gmail/disconnect",
                headers=auth_headers,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True

        status_response = await async_client.get(
            "/api/v1/integrations/gmail/status",
            headers=auth_headers,
        )
        assert status_response.json()["connected"] is False

    async def test_disconnect_gmail_unauthorized(
        self,
        async_client: AsyncClient,
    ) -> None:
        response = await async_client.post(
            "/api/v1/integrations/gmail/disconnect",
        )

        assert response.status_code == 401

    async def test_disconnect_gmail_when_not_connected(
        self,
        async_client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        await async_client.delete(
            "/api/v1/integrations/gmail/oauth-client",
            headers=auth_headers,
        )

        response = await async_client.post(
            "/api/v1/integrations/gmail/disconnect",
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
