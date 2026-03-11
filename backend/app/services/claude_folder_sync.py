import copy
import json
import logging
import os
from pathlib import Path
from typing import Any

from app.constants import CLAUDE_DIR
from app.core.config import get_settings
from app.models.types import InstalledPluginDict

settings = get_settings()
logger = logging.getLogger(__name__)
CLAUDE_PLUGINS_DIR = CLAUDE_DIR / "plugins"
CLAUDE_PLUGINS_CACHE_DIR = CLAUDE_PLUGINS_DIR / "cache"
INSTALLED_PLUGINS_JSON = CLAUDE_PLUGINS_DIR / "installed_plugins.json"


class ClaudeFolderSync:
    """Plugin-related utilities for ~/.claude/ in desktop mode."""

    @staticmethod
    def is_active() -> bool:
        return settings.DESKTOP_MODE

    @staticmethod
    def read_installed_plugins() -> dict[str, Any] | None:
        if not INSTALLED_PLUGINS_JSON.is_file():
            return None
        try:
            result: dict[str, Any] = json.loads(
                INSTALLED_PLUGINS_JSON.read_text(encoding="utf-8")
            )
            return result
        except (json.JSONDecodeError, OSError):
            return None

    @staticmethod
    def get_active_plugin_paths(
        data: dict[str, Any] | None = None,
    ) -> list[Path]:
        if data is None:
            data = ClaudeFolderSync.read_installed_plugins()
        if not data:
            return []
        paths: list[Path] = []
        for entries in data.get("plugins", {}).values():
            if not entries:
                continue
            install_path = entries[0].get("installPath")
            if not install_path:
                continue
            p = Path(install_path)
            if p.is_dir():
                paths.append(p)
        return paths

    @staticmethod
    def get_cli_installed_plugins() -> list[InstalledPluginDict]:
        data = ClaudeFolderSync.read_installed_plugins()
        if not data:
            return []
        results: list[InstalledPluginDict] = []
        for key, entries in data.get("plugins", {}).items():
            plugin_name = key.split("@", 1)[0] if "@" in key else key
            entry = entries[0] if entries else {}
            results.append(
                {
                    "name": plugin_name,
                    "version": entry.get("version"),
                    "installed_at": entry.get("installedAt", ""),
                    "components": [],
                }
            )
        return results

    @staticmethod
    def rewrite_installed_plugins_for_container(
        container_cache_dir: str,
        data: dict[str, Any] | None = None,
    ) -> str | None:
        if data is None:
            data = ClaudeFolderSync.read_installed_plugins()
        if not data:
            return None
        data = copy.deepcopy(data)
        host_prefix = str(CLAUDE_PLUGINS_CACHE_DIR) + os.sep
        for entries in data.get("plugins", {}).values():
            for entry in entries:
                ip = entry.get("installPath", "")
                if ip.startswith(host_prefix):
                    entry["installPath"] = container_cache_dir + ip[len(host_prefix) :]
        return json.dumps(data, indent=2)
