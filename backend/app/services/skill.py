import io
import logging
import os
import re
import zipfile
from pathlib import Path

from fastapi import UploadFile

from app.constants import (
    MAX_RESOURCE_NAME_LENGTH,
    MAX_RESOURCES_PER_USER,
    MIN_RESOURCE_NAME_LENGTH,
)
from app.core.config import get_settings
from app.models.types import CustomSkillDict, EnabledResourceInfo, YamlMetadata
from app.services.exceptions import SkillException
from app.services.resource import BaseMarkdownResourceService
from app.utils.yaml_parser import YAMLParser

settings = get_settings()
logger = logging.getLogger(__name__)
MAX_SKILL_SIZE_BYTES = 100 * 1024 * 1024


class SkillService:
    def __init__(self) -> None:
        self.storage_path = Path(settings.STORAGE_PATH)
        self.skills_base_path = self.storage_path / "skills"
        self.skills_base_path.mkdir(parents=True, exist_ok=True)

    def _get_user_skills_path(self, user_id: str) -> Path:
        path = self.skills_base_path / str(user_id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _get_skill_path(self, user_id: str, skill_name: str) -> Path:
        return self._get_user_skills_path(user_id) / f"{skill_name}.zip"

    def sanitize_name(self, name: str) -> str:
        name = name.lower().replace(" ", "-")
        name = re.sub(r"[^a-z0-9\-_]", "", name)
        name = re.sub(r"-+", "-", name)
        name = name.strip("-")

        if not name or len(name) < MIN_RESOURCE_NAME_LENGTH:
            raise SkillException(
                f"Skill name must be at least {MIN_RESOURCE_NAME_LENGTH} characters "
                "after sanitization"
            )

        if len(name) > MAX_RESOURCE_NAME_LENGTH:
            raise SkillException(
                f"Skill name too long (max {MAX_RESOURCE_NAME_LENGTH} characters)"
            )

        return name

    find_item_index_by_name = BaseMarkdownResourceService.find_item_index_by_name

    def validate_exact_sanitized_name(self, name: str) -> None:
        if self.sanitize_name(name) != name:
            raise SkillException("Invalid skill name format")

    def _parse_skill_yaml(self, content: str) -> YamlMetadata:
        try:
            parsed = YAMLParser.parse(content)
        except ValueError as e:
            raise SkillException(str(e))

        metadata = parsed["metadata"]

        if "name" not in metadata:
            raise SkillException("YAML frontmatter must include 'name' field")
        if not isinstance(metadata["name"], str):
            raise SkillException("YAML frontmatter 'name' must be a string")

        if "description" not in metadata:
            raise SkillException("YAML frontmatter must include 'description' field")
        if not isinstance(metadata["description"], str):
            raise SkillException("YAML frontmatter 'description' must be a string")

        return metadata

    def _validate_zip_structure(
        self, zip_file: zipfile.ZipFile
    ) -> tuple[YamlMetadata, int, int]:
        file_list = zip_file.namelist()

        skill_md_candidates = [
            f for f in file_list if f.endswith("SKILL.md") or f.endswith("skill.md")
        ]

        if not skill_md_candidates:
            raise SkillException("ZIP must contain a SKILL.md file")

        if len(skill_md_candidates) > 1:
            raise SkillException("ZIP must contain only one SKILL.md file")

        skill_md_path = skill_md_candidates[0]
        try:
            skill_content = zip_file.read(skill_md_path).decode("utf-8")
        except UnicodeDecodeError:
            raise SkillException("SKILL.md must be a valid UTF-8 text file")

        metadata = self._parse_skill_yaml(skill_content)

        file_count = len([f for f in file_list if not f.endswith("/")])
        total_size = sum(info.file_size for info in zip_file.infolist())

        return metadata, file_count, total_size

    async def upload(
        self, user_id: str, file: UploadFile, current_skills: list[CustomSkillDict]
    ) -> CustomSkillDict:
        if len(current_skills) >= MAX_RESOURCES_PER_USER:
            raise SkillException(f"Maximum {MAX_RESOURCES_PER_USER} skills per user")

        contents = await file.read()

        if len(contents) > MAX_SKILL_SIZE_BYTES:
            raise SkillException(
                f"Skill package too large (max {MAX_SKILL_SIZE_BYTES / 1024 / 1024}MB)"
            )

        try:
            with zipfile.ZipFile(io.BytesIO(contents)) as zf:
                metadata, file_count, total_size = self._validate_zip_structure(zf)
                skill_name = self.sanitize_name(metadata.get("name", ""))

                if any(s.get("name") == skill_name for s in current_skills):
                    raise SkillException(f"Skill '{skill_name}' already exists")

                final_zip_path = self._get_skill_path(user_id, skill_name)

                if final_zip_path.exists():
                    os.remove(final_zip_path)

                with open(final_zip_path, "wb") as f:
                    f.write(contents)

                logger.info(
                    f"Stored skill ZIP: {skill_name}, "
                    f"size={len(contents)}, "
                    f"decompressed_size={total_size}, "
                    f"files={file_count}"
                )

        except zipfile.BadZipFile:
            raise SkillException("Invalid ZIP file")
        except SkillException:
            raise

        return {
            "name": skill_name,
            "description": metadata.get("description", ""),
            "enabled": True,
            "size_bytes": total_size,
            "file_count": file_count,
        }

    async def delete(self, user_id: str, skill_name: str) -> None:
        skill_path = self._get_skill_path(user_id, skill_name)
        if skill_path.exists():
            os.remove(skill_path)

    def get_enabled(
        self, user_id: str, custom_skills: list[CustomSkillDict]
    ) -> list[EnabledResourceInfo]:
        if not custom_skills:
            return []

        enabled: list[EnabledResourceInfo] = []
        for skill in custom_skills:
            if skill.get("enabled", True):
                skill_path = self._get_skill_path(user_id, str(skill["name"]))
                if skill_path.exists() and skill_path.is_file():
                    enabled.append(
                        {"name": str(skill["name"]), "path": str(skill_path)}
                    )
        return enabled
