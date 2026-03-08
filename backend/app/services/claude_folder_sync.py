import copy
import json
import logging
import os
import shutil
import stat as stat_module
import zipfile
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import TypeVar, cast

from app.core.config import get_settings
from app.models.types import (
    CustomAgentDict,
    CustomSkillDict,
    CustomSlashCommandDict,
    YamlMetadata,
)
from app.utils.yaml_parser import YAMLParser

settings = get_settings()
logger = logging.getLogger(__name__)

CLAUDE_DIR = Path.home() / ".claude"
CLAUDE_AGENTS_DIR = CLAUDE_DIR / "agents"
CLAUDE_COMMANDS_DIR = CLAUDE_DIR / "commands"
CLAUDE_SKILLS_DIR = CLAUDE_DIR / "skills"
CLAUDE_PLUGINS_DIR = CLAUDE_DIR / "plugins"
CLAUDE_PLUGINS_CACHE_DIR = CLAUDE_PLUGINS_DIR / "cache"
INSTALLED_PLUGINS_JSON = CLAUDE_PLUGINS_DIR / "installed_plugins.json"

T = TypeVar("T", bound=Mapping[str, object])


class ClaudeFolderSync:
    """Bidirectional sync between Agentrove's storage and ~/.claude/ in desktop mode.

    In desktop mode, HOME is not overridden, so the Claude CLI reads agents,
    commands, and skills from ~/.claude/. This service ensures that:
    1. Resources managed by Agentrove are written to ~/.claude/ so the CLI finds them
    2. Resources already in ~/.claude/ (from Claude CLI usage) are discovered by Agentrove
    """

    @staticmethod
    def is_active() -> bool:
        return settings.DESKTOP_MODE

    @staticmethod
    def _parse_md_metadata(content: str) -> YamlMetadata:
        try:
            parsed = YAMLParser.parse(content)
            return parsed["metadata"]
        except (ValueError, KeyError):
            return {}

    @staticmethod
    def read_installed_plugins() -> dict | None:
        if not INSTALLED_PLUGINS_JSON.is_file():
            return None
        try:
            return json.loads(INSTALLED_PLUGINS_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    @staticmethod
    def get_active_plugin_paths(
        data: dict | None = None,
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
    def rewrite_installed_plugins_for_container(
        container_cache_dir: str,
        data: dict | None = None,
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

    @staticmethod
    def _discover_with_plugins(
        discover_fn: Callable[..., list[T]],
        subdir: str,
        plugin_paths: list[Path],
    ) -> list[T]:
        results = discover_fn()
        for plugin_dir in plugin_paths:
            results.extend(discover_fn(plugin_dir / subdir))
        return results

    @staticmethod
    def _merge_by_name(
        db_items: list[T] | None,
        discovered: list[T],
    ) -> list[T]:
        existing = list(db_items) if db_items else []
        existing_names = {str(item["name"]).lower() for item in existing}
        for item in discovered:
            if str(item["name"]).lower() not in existing_names:
                existing.append(item)
        return existing

    @staticmethod
    def _discover_md_resources(
        directory: Path, service_cls: type
    ) -> list[Mapping[str, object]]:
        if not directory.is_dir():
            return []
        service = service_cls()
        results = []
        for md_file in directory.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            metadata = ClaudeFolderSync._parse_md_metadata(content)
            results.append(service._build_response(md_file.stem, metadata, content))
        return results

    @staticmethod
    def discover_agents(
        base_dir: Path = CLAUDE_AGENTS_DIR,
    ) -> list[CustomAgentDict]:
        from app.services.agent import AgentService

        return cast(
            list[CustomAgentDict],
            ClaudeFolderSync._discover_md_resources(base_dir, AgentService),
        )

    @staticmethod
    def discover_commands(
        base_dir: Path = CLAUDE_COMMANDS_DIR,
    ) -> list[CustomSlashCommandDict]:
        from app.services.command import CommandService

        return cast(
            list[CustomSlashCommandDict],
            ClaudeFolderSync._discover_md_resources(base_dir, CommandService),
        )

    @staticmethod
    def discover_skills(
        base_dir: Path = CLAUDE_SKILLS_DIR,
    ) -> list[CustomSkillDict]:
        if not base_dir.is_dir():
            return []
        skills: list[CustomSkillDict] = []
        for entry in base_dir.iterdir():
            if not entry.is_dir():
                continue
            skill_md = entry / "SKILL.md"
            if not skill_md.exists():
                skill_md = entry / "skill.md"
            if not skill_md.exists():
                continue
            try:
                content = skill_md.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            metadata = ClaudeFolderSync._parse_md_metadata(content)
            file_count = 0
            total_size = 0
            for f in entry.rglob("*"):
                try:
                    st = f.stat()
                except OSError:
                    continue
                if stat_module.S_ISREG(st.st_mode):
                    file_count += 1
                    total_size += st.st_size
            skills.append(
                {
                    "name": entry.name,
                    "description": str(metadata.get("description", "")),
                    "enabled": True,
                    "size_bytes": total_size,
                    "file_count": file_count,
                }
            )
        return skills

    @staticmethod
    def discover_all(
        claude_dir: Path = CLAUDE_DIR,
    ) -> tuple[
        list[CustomAgentDict], list[CustomSlashCommandDict], list[CustomSkillDict]
    ]:
        return (
            ClaudeFolderSync.discover_agents(claude_dir / "agents"),
            ClaudeFolderSync.discover_commands(claude_dir / "commands"),
            ClaudeFolderSync.discover_skills(claude_dir / "skills"),
        )

    @staticmethod
    def merge_agents(
        db_agents: list[CustomAgentDict] | None,
        plugin_paths: list[Path] | None = None,
    ) -> list[CustomAgentDict]:
        if plugin_paths is None:
            plugin_paths = ClaudeFolderSync.get_active_plugin_paths()
        discovered = ClaudeFolderSync._discover_with_plugins(
            ClaudeFolderSync.discover_agents, "agents", plugin_paths
        )
        return ClaudeFolderSync._merge_by_name(db_agents, discovered)

    @staticmethod
    def merge_commands(
        db_commands: list[CustomSlashCommandDict] | None,
        plugin_paths: list[Path] | None = None,
    ) -> list[CustomSlashCommandDict]:
        if plugin_paths is None:
            plugin_paths = ClaudeFolderSync.get_active_plugin_paths()
        discovered = ClaudeFolderSync._discover_with_plugins(
            ClaudeFolderSync.discover_commands, "commands", plugin_paths
        )
        return ClaudeFolderSync._merge_by_name(db_commands, discovered)

    @staticmethod
    def merge_skills(
        db_skills: list[CustomSkillDict] | None,
        plugin_paths: list[Path] | None = None,
    ) -> list[CustomSkillDict]:
        if plugin_paths is None:
            plugin_paths = ClaudeFolderSync.get_active_plugin_paths()
        discovered = ClaudeFolderSync._discover_with_plugins(
            ClaudeFolderSync.discover_skills, "skills", plugin_paths
        )
        return ClaudeFolderSync._merge_by_name(db_skills, discovered)

    @staticmethod
    def _write_md(directory: Path, name: str, content: str) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{name}.md"
        # Remove dangling symlinks left by old sandbox-based deployments;
        # write_text fails on a symlink whose target no longer exists.
        if path.is_symlink():
            path.unlink()
        path.write_text(content, encoding="utf-8")

    @staticmethod
    def _delete_md(directory: Path, name: str) -> None:
        path = directory / f"{name}.md"
        if path.is_symlink() or path.exists():
            os.remove(path)

    @staticmethod
    def write_agent(name: str, content: str) -> None:
        ClaudeFolderSync._write_md(CLAUDE_AGENTS_DIR, name, content)

    @staticmethod
    def delete_agent(name: str) -> None:
        ClaudeFolderSync._delete_md(CLAUDE_AGENTS_DIR, name)

    @staticmethod
    def write_command(name: str, content: str) -> None:
        ClaudeFolderSync._write_md(CLAUDE_COMMANDS_DIR, name, content)

    @staticmethod
    def delete_command(name: str) -> None:
        ClaudeFolderSync._delete_md(CLAUDE_COMMANDS_DIR, name)

    @staticmethod
    def write_skill(name: str, zip_path: Path) -> None:
        from app.services.skill import SkillService

        skill_dir = CLAUDE_SKILLS_DIR / name
        if skill_dir.is_symlink():
            skill_dir.unlink()
        elif skill_dir.exists():
            shutil.rmtree(skill_dir)
        skill_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path, "r") as zf:
            for rel, file_bytes in SkillService.iter_zip_entries(zf, name):
                dest = skill_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(file_bytes)

    @staticmethod
    def delete_skill(name: str) -> None:
        skill_dir = CLAUDE_SKILLS_DIR / name
        if skill_dir.is_symlink():
            skill_dir.unlink()
        elif skill_dir.exists():
            shutil.rmtree(skill_dir)

    @staticmethod
    def export_all_to_claude_folder(
        user_id: str,
        agents: list[CustomAgentDict] | None,
        commands: list[CustomSlashCommandDict] | None,
        skills: list[CustomSkillDict] | None,
    ) -> None:
        """Write all enabled resources from Agentrove storage to ~/.claude/."""
        storage = Path(settings.STORAGE_PATH)

        if agents:
            for agent in agents:
                if not agent.get("enabled", True):
                    continue
                content = agent.get("content")
                if content:
                    ClaudeFolderSync.write_agent(agent["name"], content)

        if commands:
            for cmd in commands:
                if not cmd.get("enabled", True):
                    continue
                content = cmd.get("content")
                if content:
                    ClaudeFolderSync.write_command(cmd["name"], content)

        if skills:
            for skill in skills:
                if not skill.get("enabled", True):
                    continue
                zip_path = storage / "skills" / user_id / f"{skill['name']}.zip"
                if zip_path.exists():
                    ClaudeFolderSync.write_skill(skill["name"], zip_path)
