import asyncio
import hashlib
import io
import json
import logging
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any, cast

from app.models.types import (
    MarketplaceAuthorDict,
    MarketplacePluginDict,
    PluginComponentsDict,
    PluginDetailsDict,
)
from app.constants import CLAUDE_DIR
from app.services.exceptions import ErrorCode, MarketplaceException

logger = logging.getLogger(__name__)

CLAUDE_PLUGINS_DIR = CLAUDE_DIR / "plugins"
KNOWN_MARKETPLACES_JSON = CLAUDE_PLUGINS_DIR / "known_marketplaces.json"
EXTERNAL_PLUGINS_CACHE_DIR = CLAUDE_PLUGINS_DIR / "external_cache"
EXTERNAL_SOURCE_PREFIX = "external:"
MAX_SKILL_FILES = 50
CLONE_TIMEOUT_SECONDS = 30
SAFE_PATH_SEGMENT = re.compile(r"^[a-zA-Z0-9_\-\.]+$")


def _empty_components() -> PluginComponentsDict:
    return {
        "agents": [],
        "commands": [],
        "skills": [],
        "mcp_servers": [],
        "lsp_servers": [],
    }


class MarketplaceService:
    @staticmethod
    def _read_known_marketplaces() -> dict[str, Any]:
        if not KNOWN_MARKETPLACES_JSON.is_file():
            return {}
        try:
            result: dict[str, Any] = json.loads(
                KNOWN_MARKETPLACES_JSON.read_text(encoding="utf-8")
            )
            return result
        except (json.JSONDecodeError, OSError):
            return {}

    @staticmethod
    def _validate_path_segment(segment: str) -> bool:
        if not segment:
            return False
        if segment in (".", ".."):
            return False
        if not SAFE_PATH_SEGMENT.match(segment):
            return False
        return True

    @staticmethod
    def _validate_component_name(name: str) -> str:
        if not MarketplaceService._validate_path_segment(name):
            raise MarketplaceException(
                f"Invalid component name: {name}",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        return name

    def _resolve_local_plugin_dir(self, source: str, marketplace: str) -> Path | None:
        if source.startswith(EXTERNAL_SOURCE_PREFIX):
            return self._resolve_external_cache_dir(source)
        known = self._read_known_marketplaces()
        marketplace_info = known.get(marketplace)
        if not marketplace_info:
            return None
        install_location = marketplace_info.get("installLocation")
        if not install_location:
            return None
        clean_source = source.lstrip("./")
        local_dir = Path(install_location) / clean_source
        if local_dir.is_dir():
            return local_dir
        return None

    @staticmethod
    def _parse_external_source(source: str) -> tuple[str, str]:
        raw = source.removeprefix(EXTERNAL_SOURCE_PREFIX)
        if "#" in raw:
            url, subpath = raw.split("#", 1)
            return url, subpath
        return raw, ""

    @staticmethod
    def _external_clone_dir(url: str) -> Path:
        url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
        return EXTERNAL_PLUGINS_CACHE_DIR / url_hash

    @staticmethod
    def _resolve_subpath(clone_dir: Path, subpath: str) -> Path | None:
        plugin_dir = (clone_dir / subpath).resolve() if subpath else clone_dir
        if not plugin_dir.is_relative_to(clone_dir):
            return None
        return plugin_dir if plugin_dir.is_dir() else None

    @staticmethod
    def _resolve_external_cache_dir(source: str) -> Path | None:
        url, subpath = MarketplaceService._parse_external_source(source)
        if not url:
            return None
        clone_dir = MarketplaceService._external_clone_dir(url)
        if not clone_dir.is_dir():
            return None
        return MarketplaceService._resolve_subpath(clone_dir, subpath)

    async def _ensure_external_clone(self, source: str) -> Path | None:
        url, subpath = self._parse_external_source(source)
        if not url:
            return None
        clone_dir = self._external_clone_dir(url)
        if clone_dir.is_dir():
            return self._resolve_subpath(clone_dir, subpath)
        EXTERNAL_PLUGINS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        try:
            proc = await asyncio.create_subprocess_exec(
                "git",
                "clone",
                "--depth",
                "1",
                "--single-branch",
                url,
                str(clone_dir),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=CLONE_TIMEOUT_SECONDS
            )
            if proc.returncode != 0:
                logger.error(
                    "git clone failed for %s: %s", url, stderr.decode(errors="replace")
                )
                await asyncio.to_thread(shutil.rmtree, clone_dir, True)
                return None
        except asyncio.TimeoutError:
            logger.error("git clone timed out for %s", url)
            proc.kill()
            await proc.wait()
            await asyncio.to_thread(shutil.rmtree, clone_dir, True)
            return None
        except FileNotFoundError:
            logger.error("git not found on PATH")
            return None
        result = self._resolve_subpath(clone_dir, subpath)
        if result is None and subpath:
            logger.error("Cloned %s but subpath '%s' not found", url, subpath)
        return result

    @staticmethod
    def _extract_names(items: list[Any]) -> list[str]:
        return [
            name
            for x in items
            if (name := x if isinstance(x, str) else x.get("name", ""))
        ]

    def _normalize_plugin(self, raw: dict[str, Any]) -> MarketplacePluginDict:
        author_raw = raw.get("author") or raw.get("owner")
        author: MarketplaceAuthorDict | None = None
        if isinstance(author_raw, str):
            author = {"name": author_raw}
        elif isinstance(author_raw, dict):
            author = cast(MarketplaceAuthorDict, author_raw)

        source_raw = raw.get("source", "")
        if isinstance(source_raw, dict):
            url = source_raw.get("url", "")
            subpath = source_raw.get("path", "")
            source = (
                f"{EXTERNAL_SOURCE_PREFIX}{url}#{subpath}"
                if subpath
                else f"{EXTERNAL_SOURCE_PREFIX}{url}"
            )
        else:
            source = source_raw

        mcp_servers_raw = raw.get("mcpServers")
        mcp_servers = (
            list(mcp_servers_raw.keys()) if isinstance(mcp_servers_raw, dict) else []
        )
        lsp_servers_raw = raw.get("lspServers")
        lsp_servers = (
            list(lsp_servers_raw.keys()) if isinstance(lsp_servers_raw, dict) else []
        )

        return {
            "name": raw.get("name", ""),
            "description": raw.get("description", ""),
            "category": raw.get("category", "other"),
            "source": source,
            "marketplace": "",
            "version": raw.get("version"),
            "author": author,
            "homepage": raw.get("homepage"),
            "components": {
                "agents": self._extract_names(raw.get("agents") or []),
                "commands": self._extract_names(raw.get("commands") or []),
                "skills": self._extract_names(raw.get("skills") or []),
                "mcp_servers": mcp_servers,
                "lsp_servers": lsp_servers,
            },
        }

    async def fetch_catalog(self) -> list[MarketplacePluginDict]:
        known = self._read_known_marketplaces()
        if not known:
            return []
        all_plugins: list[MarketplacePluginDict] = []
        for marketplace_name, info in known.items():
            install_location = info.get("installLocation")
            if not install_location:
                continue
            catalog_path = (
                Path(install_location) / ".claude-plugin" / "marketplace.json"
            )
            if not catalog_path.is_file():
                continue
            try:
                data = json.loads(catalog_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            for plugin in data.get("plugins", []):
                normalized = self._normalize_plugin(plugin)
                normalized["marketplace"] = marketplace_name
                all_plugins.append(normalized)
        deduplicated: dict[str, MarketplacePluginDict] = {}
        for plugin in all_plugins:
            name = plugin["name"]
            if name not in deduplicated:
                deduplicated[name] = plugin
            else:
                existing_source = deduplicated[name].get("source", "")
                new_source = plugin.get("source", "")
                if existing_source.startswith(
                    EXTERNAL_SOURCE_PREFIX
                ) and not new_source.startswith(EXTERNAL_SOURCE_PREFIX):
                    deduplicated[name] = plugin

        return list(deduplicated.values())

    async def get_plugin_details(self, plugin_name: str) -> PluginDetailsDict:
        catalog = await self.fetch_catalog()

        plugin = next((p for p in catalog if p["name"] == plugin_name), None)
        if not plugin:
            raise MarketplaceException(
                f"Plugin '{plugin_name}' not found",
                error_code=ErrorCode.MARKETPLACE_PLUGIN_NOT_FOUND,
                status_code=404,
            )

        source = plugin.get("source", "")
        marketplace = plugin.get("marketplace", "")

        is_external = source.startswith(EXTERNAL_SOURCE_PREFIX)
        readme: str | None = None
        catalog_components = plugin.get("components")
        components: PluginComponentsDict = _empty_components()
        if catalog_components:
            components.update(catalog_components)
        if is_external:
            local_dir = await self._ensure_external_clone(source)
        else:
            local_dir = self._resolve_local_plugin_dir(source, marketplace)
        if local_dir:
            readme = self._read_local_readme(local_dir)
            discovered = self._discover_components_local(local_dir)
            for k in ("agents", "commands", "skills", "mcp_servers", "lsp_servers"):
                if discovered.get(k):
                    components[k] = discovered[k]

        return {
            "name": plugin["name"],
            "description": plugin.get("description", ""),
            "category": plugin.get("category", "other"),
            "source": source,
            "marketplace": marketplace,
            "version": plugin.get("version"),
            "author": plugin.get("author"),
            "homepage": plugin.get("homepage"),
            "readme": readme,
            "components": components,
            "is_external": is_external,
        }

    async def download_agent(
        self, source: str, agent_name: str, marketplace: str = ""
    ) -> bytes:
        agent_name = self._validate_component_name(agent_name)
        return self._read_local_file(source, marketplace, f"agents/{agent_name}.md")

    async def download_command(
        self, source: str, command_name: str, marketplace: str = ""
    ) -> bytes:
        command_name = self._validate_component_name(command_name)
        return self._read_local_file(source, marketplace, f"commands/{command_name}.md")

    async def download_skill_as_zip(
        self, source: str, skill_name: str, marketplace: str = ""
    ) -> bytes:
        skill_name = self._validate_component_name(skill_name)
        local_dir = self._resolve_local_plugin_dir(source, marketplace)
        if not local_dir:
            raise MarketplaceException(
                f"Plugin directory not found for {source}",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        skill_dir = local_dir / "skills" / skill_name
        if not skill_dir.is_dir():
            raise MarketplaceException(
                f"Skill '{skill_name}' directory not found",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        zip_buffer = io.BytesIO()
        file_count = 0
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in skill_dir.rglob("*"):
                if not f.is_file():
                    continue
                if file_count >= MAX_SKILL_FILES:
                    logger.warning("Max skill file count (%d) reached", MAX_SKILL_FILES)
                    break
                rel = str(f.relative_to(skill_dir))
                try:
                    zf.writestr(rel, f.read_bytes())
                    file_count += 1
                except OSError as e:
                    logger.warning("Failed to read %s: %s", f, e)
        if file_count == 0:
            raise MarketplaceException(
                f"Skill '{skill_name}' has no files",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        zip_buffer.seek(0)
        return zip_buffer.read()

    def _download_config_file(
        self, source: str, filename: str, marketplace: str = ""
    ) -> dict[str, Any] | None:
        local_dir = self._resolve_local_plugin_dir(source, marketplace)
        if not local_dir:
            return None
        config_path = local_dir / filename
        if not config_path.is_file():
            return None
        try:
            return cast(
                dict[str, Any],
                json.loads(config_path.read_text(encoding="utf-8")),
            )
        except (json.JSONDecodeError, OSError):
            return None

    async def download_mcp_config(
        self, source: str, marketplace: str = ""
    ) -> dict[str, Any] | None:
        return self._download_config_file(source, ".mcp.json", marketplace)

    def _read_local_file(self, source: str, marketplace: str, rel_path: str) -> bytes:
        local_dir = self._resolve_local_plugin_dir(source, marketplace)
        if not local_dir:
            raise MarketplaceException(
                f"Plugin directory not found for {source}",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        file_path = local_dir / rel_path
        if not file_path.is_file():
            raise MarketplaceException(
                f"File not found: {rel_path}",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            )
        try:
            return file_path.read_bytes()
        except OSError as e:
            raise MarketplaceException(
                f"Failed to read {rel_path}: {e}",
                error_code=ErrorCode.MARKETPLACE_INSTALL_FAILED,
            ) from e

    @staticmethod
    def _read_local_readme(plugin_dir: Path) -> str | None:
        readme = plugin_dir / "README.md"
        if not readme.is_file():
            return None
        try:
            return readme.read_text(encoding="utf-8")
        except OSError:
            return None

    @staticmethod
    def _discover_components_local(plugin_dir: Path) -> PluginComponentsDict:
        components: PluginComponentsDict = _empty_components()

        agents_dir = plugin_dir / "agents"
        if agents_dir.is_dir():
            components["agents"] = [f.stem for f in agents_dir.glob("*.md")]

        commands_dir = plugin_dir / "commands"
        if commands_dir.is_dir():
            components["commands"] = [f.stem for f in commands_dir.glob("*.md")]

        skills_dir = plugin_dir / "skills"
        if skills_dir.is_dir():
            components["skills"] = [
                d.name
                for d in skills_dir.iterdir()
                if d.is_dir()
                and not d.name.startswith(".")
                and MarketplaceService._validate_path_segment(d.name)
            ]

        components["mcp_servers"] = MarketplaceService._discover_servers_from_config(
            plugin_dir, ".mcp.json", "mcpServers"
        )
        components["lsp_servers"] = MarketplaceService._discover_servers_from_config(
            plugin_dir, ".lsp.json"
        )

        return components

    @staticmethod
    def _discover_servers_from_config(
        plugin_dir: Path, config_filename: str, servers_key: str | None = None
    ) -> list[str]:
        config_path = plugin_dir / config_filename
        if not config_path.is_file():
            return []
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
            servers = data.get(servers_key, data) if servers_key else data
            return [
                k
                for k in servers.keys()
                if MarketplaceService._validate_path_segment(k)
                and isinstance(servers[k], dict)
            ]
        except (json.JSONDecodeError, OSError):
            return []
