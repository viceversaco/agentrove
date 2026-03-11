import logging
import os
import re
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Generic, NoReturn, TypeVar

from fastapi import UploadFile

from app.constants import (
    CLAUDE_DIR,
    MAX_RESOURCE_NAME_LENGTH,
    MAX_RESOURCE_SIZE_BYTES,
    MIN_RESOURCE_NAME_LENGTH,
)

from app.core.config import get_settings
from app.models.types import (
    BaseResourceDict,
    EnabledResourceInfo,
    ParsedResourceResult,
    YamlMetadata,
)
from app.services.exceptions import ServiceException
from app.utils.yaml_parser import YAMLParser

T = TypeVar("T", bound=BaseResourceDict)

settings = get_settings()
logger = logging.getLogger(__name__)


def get_resource_base() -> Path:
    if settings.DESKTOP_MODE:
        return CLAUDE_DIR
    return Path(settings.STORAGE_PATH) / ".claude"


AVAILABLE_TOOLS = [
    "Agent",
    "Bash",
    "BashOutput",
    "Edit",
    "ExitPlanMode",
    "Glob",
    "Grep",
    "KillShell",
    "LS",
    "MultiEdit",
    "NotebookEdit",
    "NotebookRead",
    "Read",
    "Skill",
    "SlashCommand",
    "TodoRead",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
    "Write",
]
VALID_COMMAND_MODELS = [
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-5-20251101",
    "claude-haiku-4-5-20251001",
]


class BaseMarkdownResourceService(ABC, Generic[T]):
    resource_type: str = ""
    max_size_bytes: int = MAX_RESOURCE_SIZE_BYTES
    exception_class: type[ServiceException] = ServiceException
    valid_models: list[str] = VALID_COMMAND_MODELS

    def __init__(self, base_path: Path | None = None) -> None:
        if base_path is not None:
            self.base_path = base_path
        else:
            self.base_path = get_resource_base() / self._get_storage_folder()
            self.base_path.mkdir(parents=True, exist_ok=True)

    @abstractmethod
    def _get_storage_folder(self) -> str:
        pass

    @abstractmethod
    def _build_response(self, name: str, metadata: YamlMetadata, content: str) -> T:
        pass

    def _get_resource_path(self, name: str) -> Path:
        return self.base_path / f"{name}.md"

    def resource_exists(self, name: str) -> bool:
        return self._get_resource_path(name).is_file()

    def _raise(self, message: str) -> NoReturn:
        raise self.exception_class(message)

    @staticmethod
    def find_item_index_by_name(
        items: Sequence[Mapping[str, object]], name: str
    ) -> int | None:
        return next(
            (i for i, item in enumerate(items) if item.get("name") == name), None
        )

    def validate_exact_sanitized_name(self, name: str) -> None:
        if self.sanitize_name(name) != name:
            self._raise(f"Invalid {self.resource_type.lower()} name format")

    def sanitize_name(self, name: str) -> str:
        name = name.lower().replace(" ", "-")
        name = re.sub(r"[^a-z0-9\-_]", "", name)
        name = re.sub(r"-+", "-", name)
        name = name.strip("-")

        if not name or len(name) < MIN_RESOURCE_NAME_LENGTH:
            self._raise(
                f"{self.resource_type} name must be at least "
                f"{MIN_RESOURCE_NAME_LENGTH} characters after sanitization"
            )

        if len(name) > MAX_RESOURCE_NAME_LENGTH:
            self._raise(
                f"{self.resource_type} name too long (max {MAX_RESOURCE_NAME_LENGTH} characters)"
            )

        return name

    def _parse_frontmatter(self, content: str) -> ParsedResourceResult:
        try:
            parsed = YAMLParser.parse(content)
        except ValueError as e:
            self._raise(str(e))

        metadata = parsed["metadata"]

        if "description" not in metadata:
            self._raise("YAML frontmatter must include 'description' field")
        if not isinstance(metadata["description"], str):
            self._raise("YAML frontmatter 'description' must be a string")

        return {
            "metadata": metadata,
            "content": content,
            "markdown_content": parsed["markdown_content"],
        }

    def _validate_allowed_tools(self, allowed_tools: list[str] | None) -> None:
        if allowed_tools is None:
            return

        if not isinstance(allowed_tools, list):
            self._raise("allowed_tools must be a list")

        invalid_tools = [tool for tool in allowed_tools if tool not in AVAILABLE_TOOLS]
        if invalid_tools:
            self._raise(
                f"Invalid tools in allowed_tools: {', '.join(invalid_tools)}. "
                f"Valid tools are: {', '.join(AVAILABLE_TOOLS)}"
            )

    def _validate_model(self, model: str | None) -> None:
        if model is None:
            return

        if model not in self.valid_models:
            self._raise(
                f"Invalid model '{model}'. Valid models are: {', '.join(self.valid_models)}"
            )

    @abstractmethod
    def _validate_additional_fields(self, metadata: YamlMetadata) -> None:
        pass

    def _validate_markdown_file(self, content: str) -> ParsedResourceResult:
        if len(content) > self.max_size_bytes:
            self._raise(
                f"{self.resource_type} file too large (max {self.max_size_bytes / 1024}KB)"
            )

        try:
            content.encode("utf-8")
        except UnicodeEncodeError:
            self._raise(f"{self.resource_type} file must be valid UTF-8")

        parsed = self._parse_frontmatter(content)
        metadata = parsed["metadata"]

        self._validate_allowed_tools(metadata.get("allowed_tools"))
        self._validate_model(metadata.get("model"))
        self._validate_additional_fields(metadata)

        return parsed

    def _get_name_from_filename(self, filename: str) -> str:
        name = filename.rsplit(".", 1)[0] if "." in filename else filename
        return self.sanitize_name(name)

    def _get_name_from_metadata(
        self, metadata: YamlMetadata, fallback: str | None = None
    ) -> str:
        if "name" in metadata:
            name = metadata["name"]
            if not isinstance(name, str):
                self._raise("YAML frontmatter 'name' must be a string")
            return self.sanitize_name(name)
        if fallback:
            return self.sanitize_name(fallback)
        self._raise("YAML frontmatter must include 'name' field")

    def list_all(self) -> list[T]:
        if not self.base_path.is_dir():
            return []
        results: list[T] = []
        for md_file in self.base_path.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            metadata = self._parse_md_metadata(content)
            results.append(self._build_response(md_file.stem, metadata, content))
        return results

    @staticmethod
    def _parse_md_metadata(content: str) -> YamlMetadata:
        try:
            parsed = YAMLParser.parse(content)
            return parsed["metadata"]
        except (ValueError, KeyError):
            return {}

    async def upload(
        self,
        file: UploadFile,
    ) -> T:
        if not file.filename or not file.filename.endswith(".md"):
            self._raise("File must be a .md (markdown) file")

        contents = await file.read()

        try:
            content_str = contents.decode("utf-8")
        except UnicodeDecodeError:
            self._raise(f"{self.resource_type} file must be valid UTF-8")

        parsed = self._validate_markdown_file(content_str)
        metadata = parsed["metadata"]

        sanitized_name = self._get_name_from_filename(file.filename)

        if self.resource_exists(sanitized_name):
            self._raise(f"{self.resource_type} '{sanitized_name}' already exists")

        resource_path = self._get_resource_path(sanitized_name)

        with open(resource_path, "w", encoding="utf-8") as f:
            f.write(content_str)

        logger.info(
            f"Stored {self.resource_type}: {sanitized_name}, size={len(contents)} bytes"
        )

        return self._build_response(sanitized_name, metadata, content_str)

    async def delete(self, name: str) -> None:
        resource_path = self._get_resource_path(name)
        if resource_path.exists():
            os.remove(resource_path)

    async def update(
        self,
        current_name: str,
        content: str,
    ) -> T:
        if len(content) > self.max_size_bytes:
            self._raise(
                f"{self.resource_type} file too large (max {self.max_size_bytes / 1024}KB)"
            )

        try:
            content.encode("utf-8")
        except UnicodeEncodeError:
            self._raise(f"{self.resource_type} file must be valid UTF-8")

        parsed = self._validate_markdown_file(content)
        metadata = parsed["metadata"]

        new_sanitized_name = self._get_name_from_metadata(metadata, current_name)

        if new_sanitized_name != current_name:
            if self.resource_exists(new_sanitized_name):
                self._raise(
                    f"{self.resource_type} '{new_sanitized_name}' already exists"
                )

            old_path = self._get_resource_path(current_name)
            if old_path.exists():
                os.remove(old_path)

            new_path = self._get_resource_path(new_sanitized_name)
        else:
            new_path = self._get_resource_path(current_name)

        with open(new_path, "w", encoding="utf-8") as f:
            f.write(content)

        logger.info(
            f"Updated {self.resource_type}: {current_name} -> {new_sanitized_name}, "
            f"size={len(content)} bytes"
        )

        return self._build_response(new_sanitized_name, metadata, content)

    def get_all_resource_paths(self) -> list[EnabledResourceInfo]:
        if not self.base_path.is_dir():
            return []
        resources: list[EnabledResourceInfo] = []
        for md_file in self.base_path.glob("*.md"):
            if md_file.is_file():
                resources.append({"name": md_file.stem, "path": str(md_file)})
        return resources
