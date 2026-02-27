from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from functools import partial
from typing import Any

from app.core.config import get_settings
from app.services.claude_session_registry import (
    IDLE_CHECK_INTERVAL_SECONDS,
    session_registry,
)
from app.services.refresh_token import RefreshTokenService
from app.services.scheduler import SchedulerService

settings = get_settings()

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MaintenanceJob:
    name: str
    interval_seconds: float
    run: Callable[[], Awaitable[dict[str, Any]]]


class MaintenanceService:
    def __init__(self) -> None:
        self._scheduler_service = SchedulerService()
        self._stop_event = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        self._tasks = [
            asyncio.create_task(self._run_job_loop(self._scheduled_tasks_job())),
            asyncio.create_task(self._run_job_loop(self._refresh_tokens_job())),
            asyncio.create_task(self._run_job_loop(self._idle_session_cleanup_job())),
        ]

    async def stop(self) -> None:
        self._stop_event.set()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with suppress(asyncio.CancelledError):
                await task
        await self._scheduler_service.stop()
        self._tasks.clear()

    def _scheduled_tasks_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="scheduled_tasks",
            interval_seconds=60.0,
            run=partial(self._scheduler_service.check_due_tasks, limit=100),
        )

    def _refresh_tokens_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="refresh_token_cleanup",
            interval_seconds=86400.0,
            run=RefreshTokenService.cleanup_expired_tokens_job,
        )

    def _idle_session_cleanup_job(self) -> MaintenanceJob:
        return MaintenanceJob(
            name="idle_session_cleanup",
            interval_seconds=IDLE_CHECK_INTERVAL_SECONDS,
            run=self._reap_idle_sessions,
        )

    @staticmethod
    async def _reap_idle_sessions() -> dict[str, Any]:
        await session_registry.close_idle_sessions(
            settings.CHAT_PROCESS_IDLE_TTL_SECONDS
        )
        return {}

    async def _run_job_loop(self, job: MaintenanceJob) -> None:
        while not self._stop_event.is_set():
            try:
                result = await job.run()
                if result.get("error"):
                    logger.error(
                        "Maintenance job %s failed: %s", job.name, result["error"]
                    )
            except Exception:
                logger.exception("Maintenance job %s crashed", job.name)
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=job.interval_seconds,
                )
            except asyncio.TimeoutError:
                continue
