from __future__ import annotations

import asyncio
import logging
import math
from calendar import monthrange
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Any, cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.db_models.chat import Chat, Message
from app.models.db_models.enums import (
    MessageRole,
    MessageStreamStatus,
    RecurrenceType,
    TaskExecutionStatus,
    TaskStatus,
)
from app.models.db_models.scheduled_tasks import ScheduledTask, TaskExecution
from app.models.db_models.user import User, UserSettings
from app.models.schemas.pagination import PaginatedResponse, PaginationParams
from app.models.schemas.scheduler import (
    ScheduledTaskBase,
    ScheduledTaskUpdate,
    TaskExecutionResponse,
    TaskToggleResponse,
)
from app.prompts.system_prompt import build_system_prompt_for_chat
from app.services.db import BaseDbService, SessionFactoryType
from app.services.exceptions import SchedulerException
from app.services.sandbox import SandboxService
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.streaming.runtime import ChatStreamRuntime
from app.services.streaming.types import ChatStreamRequest
from app.services.user import UserService
from app.utils.validators import APIKeyValidationError, validate_model_api_keys

logger = logging.getLogger(__name__)
settings = get_settings()


class SchedulerService(BaseDbService[ScheduledTask]):
    def __init__(self, session_factory: SessionFactoryType | None = None) -> None:
        super().__init__(session_factory)
        self._scheduled_tasks: dict[UUID, asyncio.Task[dict[str, Any]]] = {}
        self._max_concurrent_executions = max(
            1, settings.SCHEDULED_TASK_MAX_CONCURRENT_EXECUTIONS
        )

    async def stop(self) -> None:
        running_tasks = list(self._scheduled_tasks.values())
        if not running_tasks:
            return
        for scheduled_task in running_tasks:
            scheduled_task.cancel()
        for scheduled_task in running_tasks:
            with suppress(asyncio.CancelledError):
                await scheduled_task
        self._scheduled_tasks = {}

    def _active_task_count(self) -> int:
        self._scheduled_tasks = {
            eid: task for eid, task in self._scheduled_tasks.items() if not task.done()
        }
        return len(self._scheduled_tasks)

    def _parse_timezone(self, name: str | None) -> ZoneInfo:
        if not name:
            return ZoneInfo("UTC")
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError:
            return ZoneInfo("UTC")

    def _parse_time(self, value: str) -> tuple[int, int, int]:
        parts = value.split(":")
        if len(parts) < 2:
            raise SchedulerException("Invalid scheduled_time format")
        hour = int(parts[0])
        minute = int(parts[1])
        second = int(parts[2]) if len(parts) == 3 else 0
        if not 0 <= hour <= 23 or not 0 <= minute <= 59 or not 0 <= second <= 59:
            raise SchedulerException("Invalid scheduled_time value")
        return hour, minute, second

    def _next_run_utc(
        self,
        recurrence_type: RecurrenceType,
        scheduled_time: str,
        scheduled_day: int | None,
        from_time_utc: datetime,
        timezone_name: str | None,
        allow_once: bool,
    ) -> datetime | None:
        local_now = from_time_utc.astimezone(self._parse_timezone(timezone_name))
        hour, minute, second = self._parse_time(scheduled_time)

        if recurrence_type == RecurrenceType.ONCE:
            return self._next_once_run_utc(
                local_now=local_now,
                hour=hour,
                minute=minute,
                second=second,
                allow_once=allow_once,
            )

        if recurrence_type == RecurrenceType.DAILY:
            return self._next_daily_run_utc(local_now, hour, minute, second)

        if recurrence_type == RecurrenceType.WEEKLY:
            return self._next_weekly_run_utc(
                local_now=local_now,
                scheduled_day=scheduled_day,
                hour=hour,
                minute=minute,
                second=second,
            )

        if recurrence_type == RecurrenceType.MONTHLY:
            return self._next_monthly_run_utc(
                local_now=local_now,
                scheduled_day=scheduled_day,
                hour=hour,
                minute=minute,
                second=second,
            )

        raise SchedulerException(f"Unexpected recurrence type: {recurrence_type}")

    def _next_once_run_utc(
        self,
        *,
        local_now: datetime,
        hour: int,
        minute: int,
        second: int,
        allow_once: bool,
    ) -> datetime | None:
        if not allow_once:
            return None
        return self._next_daily_run_utc(local_now, hour, minute, second)

    def _next_daily_run_utc(
        self,
        local_now: datetime,
        hour: int,
        minute: int,
        second: int,
    ) -> datetime:
        target = local_now.replace(
            hour=hour, minute=minute, second=second, microsecond=0
        )
        next_local = target if target > local_now else target + timedelta(days=1)
        return next_local.astimezone(timezone.utc)

    def _next_weekly_run_utc(
        self,
        *,
        local_now: datetime,
        scheduled_day: int | None,
        hour: int,
        minute: int,
        second: int,
    ) -> datetime:
        if scheduled_day is None or not 0 <= scheduled_day <= 6:
            raise SchedulerException("Weekly tasks require scheduled_day (0-6)")
        days_ahead = (scheduled_day - local_now.weekday()) % 7
        target_date = local_now.date() + timedelta(days=days_ahead)
        target = datetime(
            target_date.year,
            target_date.month,
            target_date.day,
            hour,
            minute,
            second,
            tzinfo=local_now.tzinfo,
        )
        next_local = target if target > local_now else target + timedelta(days=7)
        return next_local.astimezone(timezone.utc)

    def _next_monthly_run_utc(
        self,
        *,
        local_now: datetime,
        scheduled_day: int | None,
        hour: int,
        minute: int,
        second: int,
    ) -> datetime:
        if scheduled_day is None or not 1 <= scheduled_day <= 31:
            raise SchedulerException("Monthly tasks require scheduled_day (1-31)")
        year = local_now.year
        month = local_now.month
        max_day = monthrange(year, month)[1]
        day = min(scheduled_day, max_day)
        target = datetime(
            year, month, day, hour, minute, second, tzinfo=local_now.tzinfo
        )
        if target <= local_now:
            if month == 12:
                year += 1
                month = 1
            else:
                month += 1
            max_day = monthrange(year, month)[1]
            day = min(scheduled_day, max_day)
            target = datetime(
                year, month, day, hour, minute, second, tzinfo=local_now.tzinfo
            )
        return target.astimezone(timezone.utc)

    def validate_recurrence_constraints(
        self, recurrence_type: RecurrenceType, scheduled_day: int | None
    ) -> None:
        if recurrence_type == RecurrenceType.WEEKLY:
            if scheduled_day is None or not 0 <= scheduled_day <= 6:
                raise SchedulerException(
                    "Weekly tasks require scheduled_day between 0 (Monday) and 6 (Sunday)"
                )
        elif recurrence_type == RecurrenceType.MONTHLY:
            if scheduled_day is None or not 1 <= scheduled_day <= 31:
                raise SchedulerException(
                    "Monthly tasks require scheduled_day between 1 and 31"
                )

    async def _user_tz(self, user_id: UUID, db: AsyncSession) -> str:
        user_settings = await UserService().get_user_settings(user_id, db=db)
        timezone_name = cast(str, user_settings.timezone)
        return timezone_name

    async def get_user_task(
        self, task_id: UUID, user_id: UUID, db: AsyncSession
    ) -> ScheduledTask:
        result = await db.execute(
            select(ScheduledTask).where(
                ScheduledTask.id == task_id,
                ScheduledTask.user_id == user_id,
            )
        )
        task = result.scalar_one_or_none()
        if not task:
            raise SchedulerException("Scheduled task not found", status_code=404)
        return cast(ScheduledTask, task)

    async def create_task(
        self, user_id: UUID, task_data: ScheduledTaskBase, db: AsyncSession
    ) -> ScheduledTask:
        self.validate_recurrence_constraints(
            task_data.recurrence_type, task_data.scheduled_day
        )

        timezone_name = await self._user_tz(user_id, db)
        next_execution = self._next_run_utc(
            task_data.recurrence_type,
            task_data.scheduled_time,
            task_data.scheduled_day,
            datetime.now(timezone.utc),
            timezone_name,
            allow_once=True,
        )
        if next_execution is None:
            raise SchedulerException("Could not calculate next execution")

        task = ScheduledTask(
            user_id=user_id,
            task_name=task_data.task_name,
            prompt_message=task_data.prompt_message,
            recurrence_type=task_data.recurrence_type,
            scheduled_time=task_data.scheduled_time,
            scheduled_day=task_data.scheduled_day,
            next_execution=next_execution,
            model_id=task_data.model_id,
            status=TaskStatus.ACTIVE,
        )

        db.add(task)
        await db.commit()
        await db.refresh(task)
        return task

    async def get_tasks(self, user_id: UUID, db: AsyncSession) -> list[ScheduledTask]:
        result = await db.execute(
            select(ScheduledTask)
            .where(ScheduledTask.user_id == user_id)
            .order_by(ScheduledTask.next_execution.asc().nulls_last())
        )
        return list(result.scalars().all())

    async def update_task(
        self,
        task_id: UUID,
        user_id: UUID,
        task_update: ScheduledTaskUpdate,
        db: AsyncSession,
    ) -> ScheduledTask:
        task = await self.get_user_task(task_id, user_id, db)
        update_data = task_update.model_dump(exclude_unset=True)
        old_status = task.status

        recalc_next = False
        for field, value in update_data.items():
            if field in {"recurrence_type", "scheduled_time", "scheduled_day"}:
                recalc_next = True
            setattr(task, field, value)

        becoming_active = (
            task.status == TaskStatus.ACTIVE and old_status != TaskStatus.ACTIVE
        )
        if recalc_next or becoming_active:
            self.validate_recurrence_constraints(
                task.recurrence_type, task.scheduled_day
            )
            timezone_name = await self._user_tz(user_id, db)
            task.next_execution = self._next_run_utc(
                task.recurrence_type,
                task.scheduled_time,
                task.scheduled_day,
                datetime.now(timezone.utc),
                timezone_name,
                allow_once=True,
            )

        await db.commit()
        await db.refresh(task)
        return task

    async def delete_task(self, task_id: UUID, user_id: UUID, db: AsyncSession) -> None:
        task = await self.get_user_task(task_id, user_id, db)
        await db.delete(task)
        await db.commit()

    async def toggle_task(
        self, task_id: UUID, user_id: UUID, db: AsyncSession
    ) -> TaskToggleResponse:
        task = await self.get_user_task(task_id, user_id, db)

        if task.status == TaskStatus.ACTIVE:
            task.status = TaskStatus.PAUSED
        else:
            self.validate_recurrence_constraints(
                task.recurrence_type, task.scheduled_day
            )
            task.status = TaskStatus.ACTIVE
            timezone_name = await self._user_tz(user_id, db)
            task.next_execution = self._next_run_utc(
                task.recurrence_type,
                task.scheduled_time,
                task.scheduled_day,
                datetime.now(timezone.utc),
                timezone_name,
                allow_once=True,
            )

        await db.commit()
        await db.refresh(task)

        is_now_active = task.status == TaskStatus.ACTIVE
        return TaskToggleResponse(
            id=task.id,
            enabled=is_now_active,
            message=f"Task {'enabled' if is_now_active else 'disabled'} successfully",
        )

    async def get_execution_history(
        self,
        task_id: UUID,
        user_id: UUID,
        pagination: PaginationParams,
        db: AsyncSession,
    ) -> PaginatedResponse[TaskExecutionResponse]:
        await self.get_user_task(task_id, user_id, db)

        count_result = await db.execute(
            select(func.count(TaskExecution.id)).where(TaskExecution.task_id == task_id)
        )
        total = count_result.scalar() or 0

        offset = (pagination.page - 1) * pagination.per_page
        result = await db.execute(
            select(TaskExecution)
            .where(TaskExecution.task_id == task_id)
            .order_by(TaskExecution.executed_at.desc())
            .offset(offset)
            .limit(pagination.per_page)
        )
        executions = result.scalars().all()

        return PaginatedResponse[TaskExecutionResponse](
            items=[TaskExecutionResponse.model_validate(e) for e in executions],
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            pages=math.ceil(total / pagination.per_page) if total > 0 else 0,
        )

    async def _claim_due_tasks(
        self,
        db: AsyncSession,
        now: datetime,
        limit: int,
    ) -> list[tuple[UUID, UUID]]:
        task_result = await db.execute(
            select(ScheduledTask)
            .where(
                ScheduledTask.status == TaskStatus.ACTIVE,
                ScheduledTask.next_execution <= now,
                ScheduledTask.next_execution.isnot(None),
            )
            .order_by(ScheduledTask.next_execution)
            .limit(limit)
        )
        tasks = list(task_result.scalars().all())

        if not tasks:
            return []

        user_ids = [task.user_id for task in tasks]
        tz_result = await db.execute(
            select(UserSettings.user_id, UserSettings.timezone).where(
                UserSettings.user_id.in_(user_ids)
            )
        )
        user_timezones = {row.user_id: row.timezone for row in tz_result.all()}

        claimed: list[tuple[UUID, UUID]] = []
        for task in tasks:
            timezone_name = user_timezones.get(task.user_id)

            if task.recurrence_type == RecurrenceType.ONCE:
                task.next_execution = None
            else:
                task.next_execution = self._next_run_utc(
                    task.recurrence_type,
                    task.scheduled_time,
                    task.scheduled_day,
                    now,
                    timezone_name,
                    allow_once=False,
                )

            task.status = TaskStatus.PENDING

            execution = TaskExecution(
                task_id=task.id,
                executed_at=now,
                status=TaskExecutionStatus.RUNNING,
            )
            db.add(execution)
            await db.flush()

            claimed.append((task.id, execution.id))

        return claimed

    def _mark_execution(
        self,
        execution: TaskExecution,
        status: TaskExecutionStatus,
        error_message: str | None = None,
    ) -> None:
        execution.status = status
        execution.completed_at = datetime.now(timezone.utc)
        if error_message:
            execution.error_message = error_message

    def _finalize_task(
        self,
        task: ScheduledTask,
        success: bool,
    ) -> None:
        if task.recurrence_type == RecurrenceType.ONCE:
            task.next_execution = None
            task.status = TaskStatus.COMPLETED if success else TaskStatus.FAILED
        else:
            task.status = TaskStatus.ACTIVE

    async def _recover_stale_executions(
        self,
        db: AsyncSession,
        now: datetime,
    ) -> int:
        active_execution_ids = set(self._scheduled_tasks.keys())
        stale_cutoff = now - timedelta(
            seconds=settings.SCHEDULED_TASK_DISPATCH_STALE_SECONDS
        )
        stale_result = await db.execute(
            select(TaskExecution, ScheduledTask)
            .join(ScheduledTask, ScheduledTask.id == TaskExecution.task_id)
            .where(
                TaskExecution.status == TaskExecutionStatus.RUNNING,
                TaskExecution.completed_at.is_(None),
                TaskExecution.executed_at <= stale_cutoff,
                ScheduledTask.status == TaskStatus.PENDING,
            )
        )

        recovered = 0
        for execution, scheduled_task in stale_result.all():
            if execution.id in active_execution_ids:
                continue
            self._mark_execution(
                execution,
                TaskExecutionStatus.FAILED,
                "Scheduled task dispatch interrupted before execution started",
            )
            self._finalize_task(scheduled_task, success=False)
            recovered += 1

        return recovered

    async def _fail_execution(
        self,
        task_id: UUID,
        execution_id: UUID,
        reason: str,
    ) -> None:
        async with self.session_factory() as db:
            execution = await db.get(TaskExecution, execution_id)
            scheduled_task = await db.get(ScheduledTask, task_id)
            if not execution or not scheduled_task:
                return
            if execution.status != TaskExecutionStatus.RUNNING:
                return
            self._mark_execution(execution, TaskExecutionStatus.FAILED, reason)
            self._finalize_task(scheduled_task, success=False)
            await db.commit()

    def _create_sandbox_service(
        self,
        user_settings: UserSettings,
        session_factory: SessionFactoryType,
    ) -> SandboxService:
        api_key = SandboxProviderFactory.resolve_api_key(
            provider_type=user_settings.sandbox_provider,
            e2b_api_key=user_settings.e2b_api_key,
            modal_api_key=user_settings.modal_api_key,
        )

        provider = SandboxProviderFactory.create(
            provider_type=user_settings.sandbox_provider,
            api_key=api_key,
        )
        return SandboxService(provider, session_factory=session_factory)

    def _on_scheduled_task_done(
        self,
        execution_id: UUID,
        scheduled_task: asyncio.Task[dict[str, Any]],
    ) -> None:
        self._scheduled_tasks.pop(execution_id, None)

    def _start_scheduled_task(self, task_id: UUID, execution_id: UUID) -> None:
        scheduled_task = asyncio.create_task(
            self.run_scheduled_task(
                task_id=task_id,
                execution_id=execution_id,
            )
        )
        self._scheduled_tasks[execution_id] = scheduled_task
        scheduled_task.add_done_callback(
            partial(self._on_scheduled_task_done, execution_id)
        )

    async def check_due_tasks(
        self,
        limit: int = 100,
    ) -> dict[str, Any]:
        active_count = self._active_task_count()
        available_slots = self._max_concurrent_executions - active_count
        if available_slots <= 0:
            return {"tasks_triggered": 0}
        claim_limit = min(limit, available_slots)

        try:
            async with self.session_factory() as db:
                now = datetime.now(timezone.utc)
                recovered = await self._recover_stale_executions(db, now=now)
                claimed = await self._claim_due_tasks(db, now=now, limit=claim_limit)
                await db.commit()
                if recovered:
                    logger.warning(
                        "Recovered %s stale scheduled task execution(s)", recovered
                    )
        except (SQLAlchemyError, SchedulerException) as e:
            logger.error("Error checking scheduled tasks: %s", e)
            return {"error": str(e)}

        for task_id, execution_id in claimed:
            try:
                self._start_scheduled_task(task_id, execution_id)
            except Exception:
                logger.exception(
                    "Failed to dispatch scheduled task %s execution %s",
                    task_id,
                    execution_id,
                )
                await self._fail_execution(
                    task_id,
                    execution_id,
                    "Scheduled task dispatch failed",
                )

        return {"tasks_triggered": len(claimed)}

    async def run_scheduled_task(
        self,
        task_id: UUID,
        execution_id: UUID,
    ) -> dict[str, Any]:
        sandbox_service: SandboxService | None = None
        sandbox_id: str | None = None

        try:
            async with self.session_factory() as db:
                scheduled_task = await db.get(ScheduledTask, task_id)
                if not scheduled_task:
                    return {"error": "Task not found"}

                execution = await db.get(TaskExecution, execution_id)
                if not execution or execution.task_id != scheduled_task.id:
                    return {"error": "Execution not found"}

                if execution.status != TaskExecutionStatus.RUNNING:
                    return {"status": "skipped", "reason": "execution_not_running"}

                user = await db.get(User, scheduled_task.user_id)
                if not user:
                    return {"error": "User not found"}

                user_settings = await UserService(
                    session_factory=self.session_factory
                ).get_user_settings(user.id, db=db)
                if not scheduled_task.model_id:
                    raise SchedulerException("Scheduled task missing model_id")
                model_id = scheduled_task.model_id

                try:
                    validate_model_api_keys(user_settings, model_id)
                except (ValueError, APIKeyValidationError) as e:
                    self._mark_execution(execution, TaskExecutionStatus.FAILED, str(e))
                    self._finalize_task(scheduled_task, success=False)
                    await db.commit()
                    return {"error": str(e)}

                prompt_message = scheduled_task.prompt_message
                task_name = scheduled_task.task_name
                user_id = user.id
                sandbox_provider = user_settings.sandbox_provider or "docker"

            sandbox_service = self._create_sandbox_service(
                user_settings, self.session_factory
            )
            sandbox_id = await sandbox_service.provider.create_sandbox()

            await sandbox_service.initialize_sandbox(
                sandbox_id=sandbox_id,
                github_token=user_settings.github_personal_access_token,
                custom_env_vars=user_settings.custom_env_vars,
                custom_skills=user_settings.custom_skills,
                custom_slash_commands=user_settings.custom_slash_commands,
                custom_agents=user_settings.custom_agents,
                user_id=str(user_id),
                auto_compact_disabled=user_settings.auto_compact_disabled,
                attribution_disabled=user_settings.attribution_disabled,
                custom_providers=user_settings.custom_providers,
                gmail_oauth_client=user_settings.gmail_oauth_client,
                gmail_oauth_tokens=user_settings.gmail_oauth_tokens,
            )

            async with self.session_factory() as db:
                chat = Chat(
                    title=task_name,
                    user_id=user_id,
                    sandbox_id=sandbox_id,
                    sandbox_provider=sandbox_provider,
                )
                db.add(chat)
                await db.flush()

                user_message = Message(
                    chat_id=chat.id,
                    content_text=prompt_message,
                    content_render={
                        "events": [{"type": "user_text", "text": prompt_message}]
                    },
                    last_seq=0,
                    active_stream_id=None,
                    role=MessageRole.USER,
                )
                assistant_message = Message(
                    chat_id=chat.id,
                    content_text="",
                    content_render={"events": []},
                    last_seq=0,
                    active_stream_id=None,
                    role=MessageRole.ASSISTANT,
                    model_id=model_id,
                    stream_status=MessageStreamStatus.IN_PROGRESS,
                )
                db.add_all([user_message, assistant_message])
                await db.flush()

                chat_id = chat.id
                chat_title = chat.title
                assistant_message_id = assistant_message.id

                execution = await db.get(TaskExecution, execution_id)
                if execution:
                    execution.chat_id = chat_id
                await db.commit()

            chat_data = {
                "id": str(chat_id),
                "user_id": str(user_id),
                "title": chat_title,
                "sandbox_id": sandbox_id,
                "session_id": None,
            }

            system_prompt = build_system_prompt_for_chat(sandbox_id, user_settings)

            await ChatStreamRuntime.execute_chat(
                request=ChatStreamRequest(
                    prompt=prompt_message,
                    system_prompt=system_prompt,
                    custom_instructions=user_settings.custom_instructions,
                    chat_data=chat_data,
                    model_id=model_id,
                    permission_mode="auto",
                    session_id=None,
                    assistant_message_id=str(assistant_message_id),
                    thinking_mode="ultra",
                    attachments=None,
                    is_custom_prompt=False,
                ),
                sandbox_service=sandbox_service,
                session_factory=self.session_factory,
            )

            async with self.session_factory() as db:
                execution = await db.get(TaskExecution, execution_id)
                scheduled_task = await db.get(ScheduledTask, task_id)
                if execution and scheduled_task:
                    assistant_status = await db.scalar(
                        select(Message.stream_status).where(
                            Message.id == assistant_message_id
                        )
                    )
                    if assistant_status == MessageStreamStatus.INTERRUPTED:
                        self._mark_execution(
                            execution,
                            TaskExecutionStatus.FAILED,
                            "Scheduled task interrupted",
                        )
                        self._finalize_task(scheduled_task, success=False)
                    else:
                        self._mark_execution(execution, TaskExecutionStatus.SUCCESS)
                        self._finalize_task(scheduled_task, success=True)
                    await db.commit()

            return {
                "status": "success",
                "task_id": str(task_id),
                "chat_id": str(chat_id),
                "execution_id": str(execution_id),
            }
        except asyncio.CancelledError:
            reason = "Scheduled task cancelled during shutdown"
            logger.warning(
                "Scheduled task %s execution %s cancelled",
                task_id,
                execution_id,
            )
            await self._fail_execution(task_id, execution_id, reason)
            return {"error": reason}
        except (SchedulerException, SQLAlchemyError, ValueError) as e:
            logger.error("Fatal error in execute_scheduled_task: %s", e)
            message = str(e)
            await self._fail_execution(task_id, execution_id, message)
            return {"error": message}
        except Exception:
            logger.exception(
                "Unexpected error in execute_scheduled_task for task %s execution %s",
                task_id,
                execution_id,
            )
            await self._fail_execution(
                task_id,
                execution_id,
                "Unexpected scheduled task error",
            )
            return {"error": "Unexpected scheduled task error"}
        finally:
            if sandbox_service is not None:
                try:
                    if sandbox_id is not None:
                        await sandbox_service.delete_sandbox(sandbox_id)
                    await sandbox_service.cleanup()
                except Exception:
                    logger.exception("Failed to clean up sandbox")
