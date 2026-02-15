from typing import Any, cast

import httpx

from app.core.config import get_settings

settings = get_settings()

DEVICE_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode"
POLL_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token"
TOKEN_EXCHANGE_URL = "https://auth.openai.com/oauth/token"
VERIFICATION_URI = "https://auth.openai.com/codex/device"
REDIRECT_URI = "https://auth.openai.com/deviceauth/callback"


class OpenAIOAuthService:
    @staticmethod
    async def start_device_authorization() -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                DEVICE_CODE_URL,
                json={"client_id": settings.OPENAI_CLIENT_ID},
            )
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())

    @staticmethod
    async def poll_device_token(device_auth_id: str, user_code: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                POLL_TOKEN_URL,
                json={
                    "device_auth_id": device_auth_id,
                    "user_code": user_code,
                },
            )
        try:
            body = resp.json()
        except Exception:
            body = {}
        return {"status_code": resp.status_code, **body}

    @staticmethod
    async def exchange_authorization_code(
        code: str, code_verifier: str
    ) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                TOKEN_EXCHANGE_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "code_verifier": code_verifier,
                    "client_id": settings.OPENAI_CLIENT_ID,
                    "redirect_uri": REDIRECT_URI,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())
