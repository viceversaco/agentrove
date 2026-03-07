from typing import Any

from sqladmin import Admin
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request
from app.core.security import verify_password
from app.models.db_models.user import User
from sqlalchemy import select
from app.core.config import get_settings


class AdminAuth(AuthenticationBackend):
    def __init__(self, secret_key: str, session_maker: Any) -> None:
        super().__init__(secret_key)
        self.session_maker = session_maker

    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = form.get("username")
        password = form.get("password")

        async with self.session_maker() as db:
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()

            if (
                user
                and password
                and isinstance(password, str)
                and verify_password(password, user.hashed_password)
            ):
                if not user.is_superuser:
                    return False

                request.session.update({"user_id": str(user.id), "email": user.email})
                return True

        return False

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        user_id = request.session.get("user_id")
        return bool(user_id)


def create_admin(app: Any, engine: Any, session_maker: Any) -> Admin:
    settings = get_settings()

    secret_key = settings.SESSION_SECRET_KEY or settings.SECRET_KEY
    authentication_backend = AdminAuth(
        secret_key=secret_key, session_maker=session_maker
    )

    admin = Admin(
        app=app,
        engine=engine,
        authentication_backend=authentication_backend,
        title="Agentrove Admin",
        base_url="/admin",
    )

    return admin
