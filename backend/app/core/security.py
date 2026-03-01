import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import cast
from uuid import UUID

from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Query, status
from fastapi_users.password import PasswordHelper
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.session import get_db
from ..models.db_models.user import User
from .config import get_settings
from .user_manager import optional_current_active_user

settings = get_settings()
password_helper = PasswordHelper()
logger = logging.getLogger(__name__)


def _get_fernet_key() -> bytes:
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(key_bytes)


_fernet = Fernet(_get_fernet_key())


def encrypt_value(value: str) -> str:
    return _fernet.encrypt(value.encode()).decode()


def decrypt_value(encrypted_value: str) -> str:
    return _fernet.decrypt(encrypted_value.encode()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        verified, _ = password_helper.verify_and_update(plain_password, hashed_password)
        return bool(verified)
    except Exception as e:
        logger.warning("Password verification failed: %s", e)
        return False


def get_password_hash(password: str) -> str:
    return str(password_helper.hash(password))


def create_chat_scoped_token(chat_id: str) -> str:
    token_data = {
        "chat_id": chat_id,
        "purpose": "permission_server",
    }

    return cast(
        str, jwt.encode(token_data, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    )


async def get_user_from_token(token: str, db: AsyncSession) -> User | None:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_aud": False},
        )
        user_id_str = payload.get("sub")
        if not user_id_str:
            logger.warning("No sub in token payload")
            return None

        user_id = UUID(user_id_str)
        result = await db.execute(select(User).filter(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            logger.info("Successfully validated token for user %s", user_id)
        else:
            logger.warning("User %s not found in database", user_id)
        return cast(User | None, user)
    except Exception as e:
        logger.error("Error validating token: %s", e)
        return None


async def get_current_user(
    token_query: str | None = Query(None, alias="token"),
    user: User | None = Depends(optional_current_active_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if token_query:
        query_user = await get_user_from_token(token_query, db)
        if query_user is None:
            raise credentials_exception
        return query_user

    if user is None:
        raise credentials_exception

    return user


def validate_chat_scoped_token(token: str, expected_chat_id: str) -> bool:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except JWTError as e:
        logger.warning("Chat-scoped token decode failed: %s", e)
        return False

    if payload.get("purpose") != "permission_server":
        return False

    return payload.get("chat_id") == expected_chat_id


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
