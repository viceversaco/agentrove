import asyncio
import logging
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

from sqlalchemy import func, select, update

from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message
from app.models.db_models.user import User
from app.models.db_models.workspace import Workspace
from app.models.schemas.workspace import WorkspaceCreate, WorkspaceUpdate
from app.models.schemas.workspace import Workspace as WorkspaceSchema
from app.models.schemas.pagination import PaginatedResponse, PaginationParams
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import ChatException, ErrorCode
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.sandbox_providers.types import SandboxProviderType
from app.services.user import UserService
from app.services.claude_session_registry import session_registry

settings = get_settings()
logger = logging.getLogger(__name__)

WORKSPACES_DIR_NAME = "workspaces"
GIT_CLONE_TIMEOUT_SECONDS = 180


class WorkspaceService(BaseDbService[Workspace]):
    def __init__(
        self,
        sandbox_service: SandboxService,
        user_service: UserService,
        session_factory: SessionFactoryType | None = None,
    ) -> None:
        super().__init__(session_factory)
        self.sandbox_service = sandbox_service
        self.user_service = user_service
        self._base_dir = (Path(settings.STORAGE_PATH) / WORKSPACES_DIR_NAME).resolve()
        self._base_dir.mkdir(parents=True, exist_ok=True)

    async def create_workspace(self, user: User, data: WorkspaceCreate) -> Workspace:
        user_settings = await self.user_service.get_user_settings(user.id)
        user_workspace_dir = (self._base_dir / str(user.id)).resolve()
        user_workspace_dir.mkdir(parents=True, exist_ok=True)

        if data.source_type == "git":
            if not data.git_url:
                raise ChatException(
                    "git_url is required for git workspace",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            normalized_url = self._normalize_git_url(data.git_url)
            workspace_path = await self._clone_git_workspace(
                user_workspace_dir, normalized_url
            )
            source_url = normalized_url
        elif data.source_type == "local":
            if not data.workspace_path:
                raise ChatException(
                    "workspace_path is required for local workspace",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            resolved = Path(data.workspace_path).expanduser().resolve()
            if not resolved.exists() or not resolved.is_dir():
                raise ChatException(
                    "workspace_path must be an existing directory",
                    error_code=ErrorCode.VALIDATION_ERROR,
                    status_code=400,
                )
            workspace_path = str(resolved)
            source_url = None
        else:
            workspace_dir = user_workspace_dir / f"{data.name}-{uuid4().hex[:8]}"
            workspace_dir.mkdir(parents=True, exist_ok=True)
            workspace_path = str(workspace_dir)
            source_url = None

        resolved_provider = data.sandbox_provider or user_settings.sandbox_provider
        sandbox_service = self.sandbox_service
        if resolved_provider != user_settings.sandbox_provider:
            provider = SandboxProviderFactory.create(
                SandboxProviderType(resolved_provider)
            )
            sandbox_service = SandboxService(provider)

        sandbox_id = await sandbox_service.provider.create_sandbox(
            workspace_path=workspace_path,
        )

        await sandbox_service.initialize_sandbox(
            sandbox_id=sandbox_id,
            github_token=user_settings.github_personal_access_token,
            custom_env_vars=user_settings.custom_env_vars,
            custom_skills=user_settings.custom_skills,
            custom_slash_commands=user_settings.custom_slash_commands,
            custom_agents=user_settings.custom_agents,
            user_id=str(user.id),
            auto_compact_disabled=user_settings.auto_compact_disabled,
            attribution_disabled=user_settings.attribution_disabled,
            custom_providers=user_settings.custom_providers,
            gmail_oauth_client=user_settings.gmail_oauth_client,
            gmail_oauth_tokens=user_settings.gmail_oauth_tokens,
        )

        try:
            async with self._session_factory() as db:
                workspace = Workspace(
                    name=data.name,
                    user_id=user.id,
                    sandbox_id=sandbox_id,
                    sandbox_provider=resolved_provider,
                    workspace_path=workspace_path,
                    source_type=data.source_type,
                    source_url=source_url,
                )
                db.add(workspace)
                await db.commit()
                await db.refresh(workspace)
                return workspace
        except Exception:
            logger.error(
                "Failed to persist workspace, cleaning up sandbox %s", sandbox_id
            )
            asyncio.create_task(sandbox_service.delete_sandbox(sandbox_id))
            raise

    async def get_user_workspaces(
        self, user: User, pagination: PaginationParams | None = None
    ) -> PaginatedResponse[WorkspaceSchema]:
        async with self._session_factory() as db:
            query = (
                select(Workspace)
                .filter(Workspace.user_id == user.id, Workspace.deleted_at.is_(None))
                .order_by(Workspace.updated_at.desc())
            )

            if pagination:
                count_query = select(func.count(Workspace.id)).filter(
                    Workspace.user_id == user.id, Workspace.deleted_at.is_(None)
                )
                total = (await db.execute(count_query)).scalar() or 0
                offset = (pagination.page - 1) * pagination.per_page
                query = query.offset(offset).limit(pagination.per_page)
            else:
                total = None

            result = await db.execute(query)
            workspaces = list(result.scalars().all())

            if total is None:
                total = len(workspaces)

            page = pagination.page if pagination else 1
            per_page = pagination.per_page if pagination else total or 1

            return PaginatedResponse[WorkspaceSchema](
                items=workspaces,
                page=page,
                per_page=per_page,
                total=total,
                pages=math.ceil(total / per_page) if total > 0 else 0,
            )

    async def get_workspace(self, workspace_id: UUID, user: User) -> Workspace:
        async with self._session_factory() as db:
            result = await db.execute(
                select(Workspace).filter(
                    Workspace.id == workspace_id,
                    Workspace.user_id == user.id,
                    Workspace.deleted_at.is_(None),
                )
            )
            workspace: Workspace | None = result.scalar_one_or_none()
            if not workspace:
                raise ChatException(
                    "Workspace not found",
                    error_code=ErrorCode.WORKSPACE_NOT_FOUND,
                    details={"workspace_id": str(workspace_id)},
                    status_code=404,
                )
            return workspace

    async def update_workspace(
        self, workspace_id: UUID, user: User, data: WorkspaceUpdate
    ) -> Workspace:
        workspace = await self.get_workspace(workspace_id, user)
        async with self._session_factory() as db:
            managed: Workspace = await db.merge(workspace)
            if data.name is not None:
                managed.name = data.name
            await db.commit()
            return managed

    async def delete_workspace(self, workspace_id: UUID, user: User) -> None:
        workspace = await self.get_workspace(workspace_id, user)
        async with self._session_factory() as db:
            workspace = await db.merge(workspace)
            now = datetime.now(timezone.utc)
            workspace.deleted_at = now

            # Soft-delete all chats in this workspace
            chat_ids_query = select(Chat.id).filter(
                Chat.workspace_id == workspace_id, Chat.deleted_at.is_(None)
            )
            chat_ids_result = await db.execute(chat_ids_query)
            chat_ids = [row[0] for row in chat_ids_result.fetchall()]

            await db.execute(
                update(Chat)
                .where(Chat.workspace_id == workspace_id, Chat.deleted_at.is_(None))
                .values(deleted_at=now)
            )

            # Soft-delete messages in those chats
            if chat_ids:
                await db.execute(
                    update(Message)
                    .where(
                        Message.chat_id.in_(chat_ids),
                        Message.deleted_at.is_(None),
                    )
                    .values(deleted_at=now)
                )

            await db.commit()

            # Terminate sessions for all chats
            for cid in chat_ids:
                asyncio.create_task(session_registry.terminate(str(cid)))

            # Destroy the container using the workspace's actual provider
            if workspace.sandbox_id:
                provider = SandboxProviderFactory.create_bound(
                    workspace.sandbox_provider,
                    sandbox_id=workspace.sandbox_id,
                    workspace_path=workspace.workspace_path,
                )
                sandbox_service = SandboxService(provider)
                asyncio.create_task(
                    sandbox_service.delete_sandbox(workspace.sandbox_id)
                )

    async def _clone_git_workspace(self, user_workspace_dir: Path, git_url: str) -> str:
        repo_name = self._extract_repo_name(git_url)
        workspace_dir = user_workspace_dir / f"{repo_name}-{uuid4().hex[:8]}"

        process = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--depth",
            "1",
            git_url,
            str(workspace_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(), timeout=GIT_CLONE_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            await asyncio.to_thread(shutil.rmtree, workspace_dir, True)
            raise ChatException(
                "Git clone timed out",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            ) from exc

        if process.returncode != 0:
            await asyncio.to_thread(shutil.rmtree, workspace_dir, True)
            error_output = (
                stderr.decode("utf-8", errors="replace").strip()
                or stdout.decode("utf-8", errors="replace").strip()
                or "Failed to clone repository"
            )
            raise ChatException(
                error_output,
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        return str(workspace_dir)

    @staticmethod
    def _normalize_git_url(git_url: str) -> str:
        candidate = git_url.strip()
        if not candidate:
            raise ChatException(
                "git_url is required for git workspace",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )

        if candidate.startswith("git@"):
            return candidate

        parsed = urlparse(candidate)
        if parsed.scheme != "https":
            raise ChatException(
                "git_url must be an HTTPS or git@... SSH URL",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )
        if parsed.username or parsed.password:
            raise ChatException(
                "git_url must not contain embedded credentials",
                error_code=ErrorCode.VALIDATION_ERROR,
                status_code=400,
            )
        return candidate

    @staticmethod
    def _extract_repo_name(git_url: str) -> str:
        normalized = git_url.rstrip("/")
        if normalized.startswith("git@"):
            normalized = normalized.split(":", 1)[-1]
        else:
            normalized = urlparse(normalized).path
        raw_name = normalized.rsplit("/", 1)[-1]
        if raw_name.endswith(".git"):
            raw_name = raw_name[:-4]
        safe_name = "".join(
            char if char.isalnum() or char in {"-", "_"} else "-" for char in raw_name
        )
        safe_name = safe_name.strip("-")
        return safe_name or "workspace"
