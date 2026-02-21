import html
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.core.deps import get_db, get_user_service
from app.core.security import get_current_user
from app.models.db_models import User
from app.models.schemas.integrations import (
    DeviceCodeResponse,
    GmailStatusResponse,
    OAuthClientResponse,
    OAuthClientUploadRequest,
    OAuthUrlResponse,
    OpenAIPollTokenRequest,
    PollTokenRequest,
    PollTokenResponse,
)
from app.services.copilot_oauth import CopilotOAuthService
from app.services.exceptions import UserException
from app.services.gmail_oauth import GmailOAuthService
from app.services.openai_oauth import VERIFICATION_URI, OpenAIOAuthService
from app.services.user import UserService

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


@router.post("/gmail/oauth-client", response_model=OAuthClientResponse)
async def upload_oauth_client(
    request: OAuthClientUploadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> OAuthClientResponse:
    is_valid, error_msg = GmailOAuthService.validate_client_config(
        request.client_config
    )
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg or "Invalid OAuth client configuration",
        )

    try:
        user_settings = await user_service.get_user_settings(current_user.id, db=db)
    except UserException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    user_settings.gmail_oauth_client = request.client_config
    user_settings.gmail_oauth_tokens = None
    user_settings.gmail_connected_at = None
    user_settings.gmail_email = None
    flag_modified(user_settings, "gmail_oauth_client")
    flag_modified(user_settings, "gmail_oauth_tokens")

    await user_service.save_settings(user_settings, db, current_user.id)

    return OAuthClientResponse(success=True, message="OAuth client configuration saved")


@router.delete("/gmail/oauth-client", response_model=OAuthClientResponse)
async def delete_oauth_client(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> OAuthClientResponse:
    try:
        user_settings = await user_service.get_user_settings(current_user.id, db=db)
    except UserException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    user_settings.gmail_oauth_client = None
    user_settings.gmail_oauth_tokens = None
    user_settings.gmail_connected_at = None
    user_settings.gmail_email = None
    flag_modified(user_settings, "gmail_oauth_client")
    flag_modified(user_settings, "gmail_oauth_tokens")

    await user_service.save_settings(user_settings, db, current_user.id)

    return OAuthClientResponse(
        success=True, message="OAuth client configuration removed"
    )


@router.get("/gmail/oauth-url", response_model=OAuthUrlResponse)
async def get_oauth_url(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> OAuthUrlResponse:
    try:
        user_settings = await user_service.get_user_settings(current_user.id, db=db)
    except UserException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if not user_settings.gmail_oauth_client:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth client not configured. Upload gcp-oauth.keys.json first.",
        )

    client_id, _ = GmailOAuthService.extract_client_credentials(
        user_settings.gmail_oauth_client
    )
    state = GmailOAuthService.create_oauth_state(current_user.id)
    url = GmailOAuthService.build_authorization_url(client_id, state)

    return OAuthUrlResponse(url=url)


def _callback_html(error: str | None, email: str | None = None) -> str:
    frontend_origin = settings.FRONTEND_URL.strip()
    parsed_origin = urlparse(frontend_origin)
    safe_origin = ""
    if parsed_origin.scheme in {"http", "https"} and parsed_origin.netloc:
        safe_origin = f"{parsed_origin.scheme}://{parsed_origin.netloc}"

    escaped_error = html.escape(error) if error else None
    escaped_email = html.escape(email) if email else None
    origin_js = json.dumps(safe_origin)

    if error:
        return f"""
<!DOCTYPE html>
<html>
<head><title>Gmail Connection Failed</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
    <div style="text-align: center;">
        <h2 style="color: #ef4444;">Connection Failed</h2>
        <p>{escaped_error}</p>
        <p style="color: #888;">You can close this window.</p>
    </div>
    <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>
"""
    return f"""
<!DOCTYPE html>
<html>
<head><title>Gmail Connected</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a1a; color: #fff;">
    <div style="text-align: center;">
        <h2 style="color: #22c55e;">Gmail Connected</h2>
        <p>Successfully connected{f" as {escaped_email}" if escaped_email else ""}.</p>
        <p style="color: #888;">This window will close automatically.</p>
    </div>
    <script>
        const targetOrigin = {origin_js};
        if (window.opener && targetOrigin) window.opener.postMessage('gmail-connected', targetOrigin);
        setTimeout(() => window.close(), 2000);
    </script>
</body>
</html>
"""


@router.get("/gmail/callback", response_class=HTMLResponse)
async def oauth_callback(
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> HTMLResponse:
    user_id = GmailOAuthService.verify_oauth_state(state)
    if not user_id:
        return HTMLResponse(
            content=_callback_html("Authentication failed: Invalid state token"),
            status_code=400,
        )

    try:
        user_settings = await user_service.get_user_settings(user_id, db=db)
    except UserException:
        return HTMLResponse(
            content=_callback_html("Authentication failed: User not found"),
            status_code=404,
        )

    if not user_settings.gmail_oauth_client:
        return HTMLResponse(
            content=_callback_html(
                "Authentication failed: OAuth client not configured"
            ),
            status_code=400,
        )

    client_id, client_secret = GmailOAuthService.extract_client_credentials(
        user_settings.gmail_oauth_client
    )

    try:
        tokens = await GmailOAuthService.exchange_code_for_tokens(
            code, client_id, client_secret
        )
    except httpx.HTTPError as e:
        logger.error("Token exchange failed: %s", e)
        return HTMLResponse(
            content=_callback_html(
                "Authentication failed: Could not exchange code for tokens"
            ),
            status_code=500,
        )

    email = await GmailOAuthService.get_user_email(tokens.get("access_token", ""))

    if "expires_in" in tokens:
        expiry = datetime.now(timezone.utc) + timedelta(seconds=tokens["expires_in"])
        tokens["expiry"] = expiry.isoformat()

    user_settings.gmail_oauth_tokens = tokens
    user_settings.gmail_connected_at = datetime.now(timezone.utc)
    user_settings.gmail_email = email
    flag_modified(user_settings, "gmail_oauth_tokens")

    await user_service.save_settings(user_settings, db, user_id)

    return HTMLResponse(content=_callback_html(None, email))


@router.get("/gmail/status", response_model=GmailStatusResponse)
async def get_gmail_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> GmailStatusResponse:
    try:
        user_settings = await user_service.get_user_settings(current_user.id, db=db)
    except UserException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return GmailStatusResponse(
        connected=user_settings.gmail_oauth_tokens is not None,
        email=user_settings.gmail_email,
        connected_at=user_settings.gmail_connected_at,
        has_oauth_client=user_settings.gmail_oauth_client is not None,
    )


@router.post("/gmail/disconnect", response_model=OAuthClientResponse)
async def disconnect_gmail(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> OAuthClientResponse:
    try:
        user_settings = await user_service.get_user_settings(current_user.id, db=db)
    except UserException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    if user_settings.gmail_oauth_tokens:
        refresh_token = user_settings.gmail_oauth_tokens.get("refresh_token")
        if refresh_token:
            await GmailOAuthService.revoke_token(refresh_token)

    user_settings.gmail_oauth_tokens = None
    user_settings.gmail_connected_at = None
    user_settings.gmail_email = None
    flag_modified(user_settings, "gmail_oauth_tokens")

    await user_service.save_settings(user_settings, db, current_user.id)

    return OAuthClientResponse(success=True, message="Gmail disconnected")


@router.post("/copilot/device-code", response_model=DeviceCodeResponse)
async def start_device_flow(
    _current_user: User = Depends(get_current_user),
) -> DeviceCodeResponse:
    try:
        data: dict[str, Any] = await CopilotOAuthService.start_device_authorization()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to initiate GitHub device authorization",
        )

    return DeviceCodeResponse(
        verification_uri=data["verification_uri"],
        user_code=data["user_code"],
        device_code=data["device_code"],
        interval=data.get("interval", 5),
        expires_in=data.get("expires_in", 900),
    )


@router.post("/copilot/poll-token", response_model=PollTokenResponse)
async def poll_token(
    request: PollTokenRequest,
    _current_user: User = Depends(get_current_user),
) -> PollTokenResponse:
    try:
        data: dict[str, Any] = await CopilotOAuthService.poll_access_token(
            request.device_code
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="GitHub token request failed")

    if data.get("access_token"):
        return PollTokenResponse(status="success", access_token=data["access_token"])

    error = data.get("error", "unknown")
    if error == "authorization_pending":
        return PollTokenResponse(status="pending")
    if error == "slow_down":
        interval = data.get("interval")
        if isinstance(interval, int) and interval > 0:
            return PollTokenResponse(status="slow_down", interval=interval)
        return PollTokenResponse(status="slow_down")

    raise HTTPException(status_code=400, detail=f"Authorization failed: {error}")


@router.post("/openai/device-code", response_model=DeviceCodeResponse)
async def start_openai_device_flow(
    _current_user: User = Depends(get_current_user),
) -> DeviceCodeResponse:
    try:
        data: dict[str, Any] = await OpenAIOAuthService.start_device_authorization()
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Failed to initiate OpenAI device authorization",
        )

    return DeviceCodeResponse(
        verification_uri=VERIFICATION_URI,
        user_code=data["user_code"],
        device_code=data["device_auth_id"],
        interval=int(data.get("interval", 5)),
        expires_in=data.get("expires_in", 900),
    )


@router.post("/openai/poll-token", response_model=PollTokenResponse)
async def poll_openai_token(
    request: OpenAIPollTokenRequest,
    _current_user: User = Depends(get_current_user),
) -> PollTokenResponse:
    try:
        data: dict[str, Any] = await OpenAIOAuthService.poll_device_token(
            request.device_code, request.user_code
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="OpenAI token request failed")

    status_code = data.get("status_code", 0)
    if status_code in (403, 404):
        return PollTokenResponse(status="pending")

    if status_code == 200:
        auth_code = data.get("authorization_code")
        code_verifier = data.get("code_verifier")
        if not auth_code or not code_verifier:
            raise HTTPException(
                status_code=502,
                detail="Incomplete authorization response from OpenAI",
            )
        try:
            tokens = await OpenAIOAuthService.exchange_authorization_code(
                auth_code, code_verifier
            )
        except httpx.HTTPError:
            raise HTTPException(
                status_code=502,
                detail="Failed to exchange OpenAI authorization code",
            )
        return PollTokenResponse(
            status="success",
            access_token=tokens["access_token"],
            refresh_token=tokens.get("refresh_token"),
        )

    raise HTTPException(
        status_code=400,
        detail=f"OpenAI authorization failed (status {status_code})",
    )
