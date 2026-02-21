import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    generate_refresh_token,
    get_refresh_token_expiry,
    hash_refresh_token,
)
from app.db.session import SessionLocal
from app.models.db_models.refresh_token import RefreshToken
from app.models.db_models.user import User
from app.services.db import SessionFactoryType
from app.services.exceptions import AuthException

logger = logging.getLogger(__name__)


class RefreshTokenService:
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        self.session_factory = session_factory or SessionLocal

    async def create_refresh_token(
        self,
        user_id: UUID,
        db: AsyncSession,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> str:
        token = generate_refresh_token()
        token_hash = hash_refresh_token(token)
        expires_at = get_refresh_token_expiry()

        refresh_token = RefreshToken(
            token_hash=token_hash,
            user_id=user_id,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        db.add(refresh_token)
        await db.commit()

        return token

    async def validate_and_rotate(
        self,
        token: str,
        db: AsyncSession,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> tuple[User, str]:
        token_hash = hash_refresh_token(token)

        result = await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )
        refresh_token = result.scalar_one_or_none()

        if not refresh_token:
            raise AuthException("Invalid or expired refresh token")

        if refresh_token.is_revoked:
            # Revoked token reuse = potential theft; revoke all tokens for this user
            await self._revoke_all_tokens(refresh_token.user_id, db)
            await db.commit()
            raise AuthException("Invalid or expired refresh token")

        if refresh_token.is_expired:
            refresh_token.revoked_at = datetime.now(timezone.utc)
            await db.commit()
            raise AuthException("Invalid or expired refresh token")

        user_result = await db.execute(
            select(User).where(User.id == refresh_token.user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user or not user.is_active:
            raise AuthException("Invalid or expired refresh token")

        refresh_token.revoked_at = datetime.now(timezone.utc)

        new_token = generate_refresh_token()
        new_token_hash = hash_refresh_token(new_token)
        new_expires_at = get_refresh_token_expiry()

        new_refresh_token = RefreshToken(
            token_hash=new_token_hash,
            user_id=user.id,
            expires_at=new_expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        db.add(new_refresh_token)
        await db.commit()

        return user, new_token

    async def revoke_token(self, token: str, db: AsyncSession) -> bool:
        token_hash = hash_refresh_token(token)

        result = await db.execute(
            select(RefreshToken).where(
                and_(
                    RefreshToken.token_hash == token_hash,
                    RefreshToken.revoked_at.is_(None),
                )
            )
        )
        refresh_token = result.scalar_one_or_none()

        if not refresh_token:
            return False

        refresh_token.revoked_at = datetime.now(timezone.utc)
        await db.commit()

        return True

    async def _revoke_all_tokens(self, user_id: UUID, db: AsyncSession) -> int:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            update(RefreshToken)
            .where(
                and_(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
            )
            .values(revoked_at=now)
        )
        return int(getattr(result, "rowcount", 0))

    async def revoke_all_user_tokens(self, user_id: UUID, db: AsyncSession) -> int:
        count = await self._revoke_all_tokens(user_id, db)
        await db.commit()
        return count

    async def cleanup_expired_and_revoked_tokens(
        self, revoked_grace_days: int = 7
    ) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        revoked_cutoff = now - timedelta(days=revoked_grace_days)

        delete_stmt = delete(RefreshToken).where(
            or_(
                RefreshToken.expires_at < now,
                RefreshToken.revoked_at < revoked_cutoff,
            )
        )

        async with self.session_factory() as db:
            result = await db.execute(delete_stmt)
            await db.commit()
            deleted_count = int(getattr(result, "rowcount", 0))
            return {"deleted_count": deleted_count}

    @classmethod
    async def cleanup_expired_tokens_job(cls) -> dict[str, Any]:
        try:
            service = cls(session_factory=SessionLocal)
            result = await service.cleanup_expired_and_revoked_tokens()
            deleted_count = result.get("deleted_count", 0)
            logger.info("Cleaned up %s expired/revoked refresh tokens", deleted_count)
            return {"deleted_count": deleted_count}
        except Exception as e:
            logger.error("Error cleaning up refresh tokens: %s", e)
            return {"error": str(e)}


refresh_token_service = RefreshTokenService()
