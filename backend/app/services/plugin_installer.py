import asyncio
import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, cast

from fastapi import UploadFile

from app.models.schemas.marketplace import InstallComponentResult
from app.models.types import (
    CustomMcpDict,
    InstalledPluginDict,
    PluginComponentsDict,
    PluginDetailsDict,
)
from app.services.agent import AgentService
from app.services.command import CommandService
from app.services.exceptions import ServiceException
from app.services.marketplace import MarketplaceService
from app.services.skill import SkillService

logger = logging.getLogger(__name__)

SUPPORTED_MCP_COMMANDS: set[str] = {"npx", "bunx", "uvx"}
CLAUDE_PLUGIN_TIMEOUT_SECONDS = 30


@dataclass
class InstallResult:
    installed: list[str]
    failed: list[InstallComponentResult]
    new_mcps: list[CustomMcpDict]


class PluginInstallerService:
    def __init__(self) -> None:
        self.marketplace = MarketplaceService()
        self.skill_service = SkillService()
        self.agent_service = AgentService()
        self.command_service = CommandService()

    async def install_components(
        self,
        details: PluginDetailsDict,
        components: list[str],
        current_mcps: list[CustomMcpDict],
    ) -> InstallResult:
        source = details.get("source", "")
        marketplace = details.get("marketplace", "")
        available_components = details.get("components", {})

        installed: list[str] = []
        failed: list[InstallComponentResult] = []
        new_mcps: list[CustomMcpDict] = []

        for component in components:
            if ":" not in component:
                failed.append(
                    InstallComponentResult(
                        component=component,
                        success=False,
                        error="Invalid component format (expected 'type:name')",
                    )
                )
                continue

            comp_type, comp_name = component.split(":", 1)

            validation_error = self._validate_component(
                comp_type, comp_name, available_components
            )
            if validation_error:
                failed.append(
                    InstallComponentResult(
                        component=component,
                        success=False,
                        error=validation_error,
                    )
                )
                continue

            try:
                if comp_type == "agent":
                    await self._install_agent(source, comp_name, marketplace)
                    installed.append(component)
                elif comp_type == "command":
                    await self._install_command(source, comp_name, marketplace)
                    installed.append(component)
                elif comp_type == "skill":
                    await self._install_skill(source, comp_name, marketplace)
                    installed.append(component)
                elif comp_type == "mcp":
                    mcp = await self._install_mcp(
                        source, comp_name, current_mcps, marketplace
                    )
                    if mcp:
                        mcp["name"] = comp_name
                        new_mcps.append(mcp)
                        installed.append(component)
                    else:
                        failed.append(
                            InstallComponentResult(
                                component=component,
                                success=False,
                                error="MCP server uses unsupported command type",
                            )
                        )
                elif comp_type == "lsp":
                    # LSP plugins always have exactly one server per plugin, so installing
                    # the plugin by name is equivalent to installing the selected server
                    plugin_name = details.get("name", comp_name)
                    await self._install_lsp(plugin_name, marketplace)
                    installed.append(component)
                else:
                    failed.append(
                        InstallComponentResult(
                            component=component,
                            success=False,
                            error=f"Unknown component type: {comp_type}",
                        )
                    )
            except (ServiceException, OSError) as e:
                logger.error(f"Failed to install {component}: {e}")
                failed.append(
                    InstallComponentResult(
                        component=component, success=False, error=str(e)
                    )
                )

        return InstallResult(
            installed=installed,
            failed=failed,
            new_mcps=new_mcps,
        )

    def _validate_component(
        self,
        comp_type: str,
        comp_name: str,
        available: PluginComponentsDict,
    ) -> str | None:
        if comp_type == "agent":
            if comp_name not in available.get("agents", []):
                return f"Agent '{comp_name}' not found in plugin"
        elif comp_type == "command":
            if comp_name not in available.get("commands", []):
                return f"Command '{comp_name}' not found in plugin"
        elif comp_type == "skill":
            if comp_name not in available.get("skills", []):
                return f"Skill '{comp_name}' not found in plugin"
        elif comp_type == "mcp":
            if comp_name not in available.get("mcp_servers", []):
                return f"MCP server '{comp_name}' not found in plugin"
        elif comp_type == "lsp":
            if comp_name not in available.get("lsp_servers", []):
                return f"LSP server '{comp_name}' not found in plugin"
        else:
            return f"Unknown component type: {comp_type}"
        return None

    async def _install_agent(
        self,
        source: str,
        agent_name: str,
        marketplace: str = "",
    ) -> None:
        content = await self.marketplace.download_agent(source, agent_name, marketplace)
        file = self._create_upload_file(f"{agent_name}.md", content)
        await self.agent_service.upload(file)

    async def _install_command(
        self,
        source: str,
        command_name: str,
        marketplace: str = "",
    ) -> None:
        content = await self.marketplace.download_command(
            source, command_name, marketplace
        )
        file = self._create_upload_file(f"{command_name}.md", content)
        await self.command_service.upload(file)

    async def _install_skill(
        self,
        source: str,
        skill_name: str,
        marketplace: str = "",
    ) -> None:
        zip_content = await self.marketplace.download_skill_as_zip(
            source, skill_name, marketplace
        )
        file = self._create_upload_file(f"{skill_name}.zip", zip_content)
        await self.skill_service.upload(file)

    async def _install_mcp(
        self,
        source: str,
        mcp_name: str,
        current_mcps: list[CustomMcpDict],
        marketplace: str = "",
    ) -> CustomMcpDict | None:
        config = await self.marketplace.download_mcp_config(source, marketplace)
        if not config:
            return None

        servers = config.get("mcpServers") or config
        server_config = servers.get(mcp_name)
        if not server_config:
            return None

        if any(m.get("name") == mcp_name for m in current_mcps):
            raise ServiceException(f"MCP server '{mcp_name}' already exists")

        return self._convert_mcp_config(mcp_name, server_config)

    def _convert_mcp_config(
        self, name: str, config: dict[str, Any]
    ) -> CustomMcpDict | None:
        mcp_type = config.get("type", "")

        if mcp_type == "http":
            return self._convert_http_mcp_config(name, config)

        command = config.get("command", "")
        args = config.get("args", [])

        if command not in SUPPORTED_MCP_COMMANDS:
            logger.warning(f"MCP server '{name}' uses unsupported command: {command}")
            return None

        command_type = cast(Literal["npx", "bunx", "uvx", "http"], command)
        package: str | None = None
        filtered_args: list[str] = []

        for arg in args:
            if arg == "-y":
                continue
            if package is None and (arg.startswith("@") or not arg.startswith("-")):
                package = arg
                continue
            filtered_args.append(arg)

        return {
            "name": name,
            "description": f"MCP server from marketplace: {name}",
            "command_type": command_type,
            "package": package,
            "url": None,
            "env_vars": config.get("env"),
            "args": filtered_args if filtered_args else None,
            "enabled": True,
        }

    def _convert_http_mcp_config(
        self, name: str, config: dict[str, Any]
    ) -> CustomMcpDict | None:
        url = config.get("url")
        if not url:
            logger.warning(f"HTTP MCP server '{name}' missing url")
            return None

        env_vars: dict[str, str] = {}
        headers = config.get("headers", {})
        for header_value in headers.values():
            if not isinstance(header_value, str):
                continue
            for match in re.finditer(r"\$\{([^}]+)\}", header_value):
                env_var_name = match.group(1)
                if env_var_name:
                    env_vars[env_var_name] = ""

        return {
            "name": name,
            "description": f"MCP server from marketplace: {name}",
            "command_type": "http",
            "package": None,
            "url": url,
            "env_vars": env_vars if env_vars else None,
            "args": None,
            "enabled": True,
        }

    async def _run_claude_plugin_command(self, action: str, plugin_ref: str) -> None:
        proc = await asyncio.create_subprocess_exec(
            "claude",
            "plugin",
            action,
            plugin_ref,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=CLAUDE_PLUGIN_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ServiceException(
                f"Timed out waiting for 'claude plugin {action} {plugin_ref}'"
            )
        if proc.returncode != 0:
            error_msg = (
                stderr.decode(errors="replace").strip()
                or stdout.decode(errors="replace").strip()
            )
            raise ServiceException(
                f"Failed to {action} plugin '{plugin_ref}': {error_msg}"
            )

    async def _install_lsp(
        self,
        plugin_name: str,
        marketplace: str = "",
    ) -> None:
        plugin_ref = f"{plugin_name}@{marketplace}" if marketplace else plugin_name
        await self._run_claude_plugin_command("install", plugin_ref)

    async def uninstall_lsp(self, plugin_ref: str) -> None:
        await self._run_claude_plugin_command("uninstall", plugin_ref)

    def _create_upload_file(self, filename: str, content: bytes) -> UploadFile:
        file_obj = io.BytesIO(content)
        return UploadFile(file=file_obj, filename=filename)

    def create_installed_record(
        self,
        plugin_name: str,
        version: str | None,
        components: list[str],
    ) -> InstalledPluginDict:
        return {
            "name": plugin_name,
            "version": version,
            "installed_at": datetime.now(timezone.utc).isoformat(),
            "components": components,
        }
