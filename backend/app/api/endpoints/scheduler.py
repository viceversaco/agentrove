from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_scheduler_service
from app.core.security import get_current_user, get_db
from app.models.db_models.scheduled_tasks import ScheduledTask
from app.models.db_models.user import User
from app.models.schemas.pagination import PaginatedResponse, PaginationParams
from app.models.schemas.scheduler import (
    ScheduledTaskBase,
    ScheduledTaskResponse,
    ScheduledTaskUpdate,
    TaskExecutionResponse,
    TaskToggleResponse,
)
from app.services.exceptions import SchedulerException
from app.services.scheduler import SchedulerService

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.post(
    "/tasks", response_model=ScheduledTaskResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit("10/minute")
async def create_scheduled_task(
    request: Request,
    task_data: ScheduledTaskBase,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> ScheduledTask:
    try:
        return await scheduler_service.create_task(current_user.id, task_data, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/tasks", response_model=list[ScheduledTaskResponse])
async def get_scheduled_tasks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> list[ScheduledTask]:
    return await scheduler_service.get_tasks(current_user.id, db)


@router.get("/tasks/{task_id}", response_model=ScheduledTaskResponse)
async def get_scheduled_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> ScheduledTask:
    try:
        return await scheduler_service.get_user_task(task_id, current_user.id, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.put("/tasks/{task_id}", response_model=ScheduledTaskResponse)
@limiter.limit("20/minute")
async def update_scheduled_task(
    request: Request,
    task_id: UUID,
    task_update: ScheduledTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> ScheduledTask:
    try:
        return await scheduler_service.update_task(
            task_id, current_user.id, task_update, db
        )
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scheduled_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> None:
    try:
        await scheduler_service.delete_task(task_id, current_user.id, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/tasks/{task_id}/toggle", response_model=TaskToggleResponse)
@limiter.limit("30/minute")
async def toggle_scheduled_task(
    request: Request,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> TaskToggleResponse:
    try:
        return await scheduler_service.toggle_task(task_id, current_user.id, db)
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get(
    "/tasks/{task_id}/history", response_model=PaginatedResponse[TaskExecutionResponse]
)
async def get_task_execution_history(
    task_id: UUID,
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> PaginatedResponse[TaskExecutionResponse]:
    try:
        return await scheduler_service.get_execution_history(
            task_id, current_user.id, pagination, db
        )
    except SchedulerException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
