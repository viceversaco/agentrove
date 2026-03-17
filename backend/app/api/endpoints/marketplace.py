from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from typing import Any, cast

from app.api.endpoints._shared import (
    append_named_item_if_missing,
    find_named_item_index,
    load_user_settings_or_404,
)
from app.core.deps import (
    get_agent_service,
    get_command_service,
    get_db,
    get_marketplace_service,
    get_plugin_installer_service,
    get_skill_service,
    get_user_service,
)
from app.core.security import get_current_user
from app.models.db_models.user import User
from app.models.schemas.marketplace import (
    InstallComponentRequest,
    InstallComponentResult,
    InstallResponse,
    InstalledPlugin,
    MarketplacePlugin,
    PluginDetails,
    UninstallComponentsRequest,
    UninstallResponse,
)
from app.models.types import (
    CustomMcpDict,
    InstalledPluginDict,
)
from app.services.agent import AgentService
from app.services.claude_folder_sync import ClaudeFolderSync
from app.services.command import CommandService
from app.services.exceptions import (
    MarketplaceException,
    ServiceException,
)
from app.services.marketplace import MarketplaceService
from app.services.plugin_installer import PluginInstallerService
from app.services.skill import SkillService
from app.services.user import UserService

router = APIRouter()


@router.get("/catalog", response_model=list[MarketplacePlugin])
async def get_catalog(
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
) -> list[MarketplacePlugin]:
    try:
        plugins = await marketplace_service.fetch_catalog()
        return [MarketplacePlugin(**p) for p in plugins]
    except MarketplaceException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/catalog/{plugin_name}", response_model=PluginDetails)
async def get_plugin_details(
    plugin_name: str,
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
) -> PluginDetails:
    try:
        details = await marketplace_service.get_plugin_details(plugin_name)
        return PluginDetails(**details)
    except MarketplaceException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.post("/install", response_model=InstallResponse)
async def install_plugin_components(
    request: InstallComponentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    marketplace_service: MarketplaceService = Depends(get_marketplace_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
    user_service: UserService = Depends(get_user_service),
) -> InstallResponse:
    user_settings = await load_user_settings_or_404(user_service, current_user.id, db)

    current_mcps = cast(list[CustomMcpDict], list(user_settings.custom_mcps or []))

    try:
        details = await marketplace_service.get_plugin_details(request.plugin_name)
    except MarketplaceException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    try:
        result = await installer_service.install_components(
            details=details,
            components=request.components,
            current_mcps=current_mcps,
        )
    except MarketplaceException as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    if result.installed:
        # MCPs still stored in DB (they don't have a filesystem representation)
        if result.new_mcps:
            if user_settings.custom_mcps is None:
                user_settings.custom_mcps = []
            for mcp in result.new_mcps:
                append_named_item_if_missing(user_settings.custom_mcps, mcp)
            flag_modified(user_settings, "custom_mcps")

        installed_plugins: list[InstalledPluginDict] = list(
            user_settings.installed_plugins or []
        )
        existing_idx = find_named_item_index(installed_plugins, request.plugin_name)
        record = installer_service.create_installed_record(
            request.plugin_name,
            details.get("version"),
            result.installed,
        )
        if existing_idx is not None:
            existing_comps = set(installed_plugins[existing_idx].get("components", []))
            existing_comps.update(result.installed)
            record["components"] = list(existing_comps)
            installed_plugins[existing_idx] = record
        else:
            installed_plugins.append(record)
        user_settings.installed_plugins = installed_plugins
        flag_modified(user_settings, "installed_plugins")

        await user_service.save_settings(user_settings, db, current_user.id)

    return InstallResponse(
        plugin_name=request.plugin_name,
        version=details.get("version"),
        installed=result.installed,
        failed=result.failed,
    )


@router.get("/installed", response_model=list[InstalledPlugin])
async def get_installed_plugins(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
) -> list[InstalledPlugin]:
    user_settings = await load_user_settings_or_404(user_service, current_user.id, db)

    installed: list[InstalledPluginDict] = list(user_settings.installed_plugins or [])

    for cli_plugin in ClaudeFolderSync.get_cli_installed_plugins():
        append_named_item_if_missing(installed, cli_plugin)

    return [InstalledPlugin(**p) for p in installed]


@router.post("/uninstall", response_model=UninstallResponse)
async def uninstall_plugin_components(
    request: UninstallComponentsRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    user_service: UserService = Depends(get_user_service),
    agent_service: AgentService = Depends(get_agent_service),
    command_service: CommandService = Depends(get_command_service),
    skill_service: SkillService = Depends(get_skill_service),
    installer_service: PluginInstallerService = Depends(get_plugin_installer_service),
) -> UninstallResponse:
    user_settings = await load_user_settings_or_404(user_service, current_user.id, db)

    uninstalled: list[str] = []
    failed: list[InstallComponentResult] = []
    lsp_plugin_key = ClaudeFolderSync.find_installed_plugin_key(request.plugin_name)
    lsp_plugin_uninstalled = False

    installed_plugins: list[InstalledPluginDict] = list(
        user_settings.installed_plugins or []
    )

    service_dispatch: dict[str, Any] = {
        "agent": agent_service,
        "command": command_service,
        "skill": skill_service,
    }

    for component_id in request.components:
        if ":" not in component_id:
            failed.append(
                InstallComponentResult(
                    component=component_id,
                    success=False,
                    error="Invalid component format",
                )
            )
            continue

        comp_type, comp_name = component_id.split(":", 1)

        if comp_type == "mcp":
            items = list(user_settings.custom_mcps or [])
            idx = find_named_item_index(items, comp_name)
            if idx is None:
                failed.append(
                    InstallComponentResult(
                        component=component_id,
                        success=False,
                        error="Mcp not found",
                    )
                )
                continue
            items.pop(idx)
            user_settings.custom_mcps = items if items else None
            flag_modified(user_settings, "custom_mcps")
            uninstalled.append(component_id)
            continue

        if comp_type == "lsp":
            if lsp_plugin_key:
                if not lsp_plugin_uninstalled:
                    try:
                        await installer_service.uninstall_lsp(lsp_plugin_key)
                        lsp_plugin_uninstalled = True
                    except (ServiceException, OSError) as e:
                        failed.append(
                            InstallComponentResult(
                                component=component_id, success=False, error=str(e)
                            )
                        )
                        continue
                uninstalled.append(component_id)
            else:
                uninstalled.append(component_id)
            continue

        service = service_dispatch.get(comp_type)
        if service is None:
            failed.append(
                InstallComponentResult(
                    component=component_id,
                    success=False,
                    error=f"Unknown component type: {comp_type}",
                )
            )
            continue

        try:
            await service.delete(comp_name)
            uninstalled.append(component_id)
        except (ServiceException, OSError) as e:
            failed.append(
                InstallComponentResult(
                    component=component_id, success=False, error=str(e)
                )
            )

    if uninstalled:
        plugin_idx = find_named_item_index(installed_plugins, request.plugin_name)
        if plugin_idx is not None:
            plugin = installed_plugins[plugin_idx]
            remaining = [
                c for c in plugin.get("components", []) if c not in uninstalled
            ]
            if remaining:
                plugin["components"] = remaining
            else:
                installed_plugins.pop(plugin_idx)
            user_settings.installed_plugins = (
                installed_plugins if installed_plugins else None
            )
            flag_modified(user_settings, "installed_plugins")

        await user_service.save_settings(user_settings, db, current_user.id)

    return UninstallResponse(
        plugin_name=request.plugin_name,
        uninstalled=uninstalled,
        failed=failed,
    )
