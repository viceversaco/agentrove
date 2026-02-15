from typing import Any, cast

import httpx

from app.core.config import get_settings

settings = get_settings()

DEVICE_CODE_URL = "https://github.com/login/device/code"
ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"


class CopilotOAuthService:
    @staticmethod
    async def start_device_authorization() -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                DEVICE_CODE_URL,
                headers={"Accept": "application/json"},
                data={"client_id": settings.GITHUB_CLIENT_ID, "scope": "read:user"},
            )
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())

    @staticmethod
    async def poll_access_token(device_code: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ACCESS_TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "device_code": device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
            )
        resp.raise_for_status()
        return cast(dict[str, Any], resp.json())
