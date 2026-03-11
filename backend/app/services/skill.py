import base64
import io
import logging
import re
import shutil
import stat as stat_module
import tempfile
import zipfile
from collections.abc import Iterator
from pathlib import Path

from fastapi import UploadFile

from app.constants import (
    MAX_RESOURCE_NAME_LENGTH,
    MIN_RESOURCE_NAME_LENGTH,
)
from app.models.types import CustomSkillDict, EnabledResourceInfo, YamlMetadata
from app.services.exceptions import SkillException
from app.services.resource import get_resource_base
from app.utils.yaml_parser import YAMLParser

logger = logging.getLogger(__name__)
MAX_SKILL_SIZE_BYTES = 100 * 1024 * 1024


class SkillService:
    @staticmethod
    def _detect_archive_root(zf: zipfile.ZipFile) -> str | None:
        """Return the common single top-level directory of the archive, or None."""
        entries = [e for e in zf.namelist() if not e.endswith("/")]
        if not entries:
            return None
        first_part = entries[0].split("/")[0]
        prefix = f"{first_part}/"
        if all(e.startswith(prefix) for e in entries):
            return prefix
        return None

    @staticmethod
    def iter_zip_entries(
        zf: zipfile.ZipFile, archive_root: str | None
    ) -> Iterator[tuple[str, bytes]]:
        """Yield (relative_path, file_bytes) for each file in a skill zip."""
        for entry in zf.namelist():
            if entry.endswith("/"):
                continue
            file_bytes = zf.read(entry)
            rel = (
                entry[len(archive_root) :]
                if archive_root and entry.startswith(archive_root)
                else entry
            )
            yield rel, file_bytes

    def __init__(self, base_path: Path | None = None) -> None:
        if base_path is not None:
            self.skills_base_path = base_path
        else:
            self.skills_base_path = get_resource_base() / "skills"
            self.skills_base_path.mkdir(parents=True, exist_ok=True)

    def _get_skill_path(self, skill_name: str) -> Path:
        return self.skills_base_path / skill_name

    def resource_exists(self, skill_name: str) -> bool:
        skill_dir = self._get_skill_path(skill_name)
        return skill_dir.is_dir() and self._find_skill_md(skill_dir) is not None

    @staticmethod
    def _find_skill_md(skill_dir: Path) -> Path | None:
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            return skill_md
        skill_md = skill_dir / "skill.md"
        if skill_md.exists():
            return skill_md
        return None

    @staticmethod
    def _compute_dir_stats(directory: Path) -> tuple[int, int]:
        file_count = 0
        total_size = 0
        for f in directory.rglob("*"):
            try:
                st = f.stat()
            except OSError:
                continue
            if stat_module.S_ISREG(st.st_mode):
                file_count += 1
                total_size += st.st_size
        return file_count, total_size

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

    def _validate_skill_dir(self, skill_dir: Path) -> tuple[YamlMetadata, int, int]:
        skill_md = self._find_skill_md(skill_dir)
        if not skill_md:
            raise SkillException("Skill directory must contain a SKILL.md file")

        try:
            skill_content = skill_md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            raise SkillException("SKILL.md must be a valid UTF-8 text file")

        metadata = self._parse_skill_yaml(skill_content)
        file_count, total_size = self._compute_dir_stats(skill_dir)

        return metadata, file_count, total_size

    def list_all(self) -> list[CustomSkillDict]:
        if not self.skills_base_path.is_dir():
            return []
        skills: list[CustomSkillDict] = []
        for entry in self.skills_base_path.iterdir():
            if not entry.is_dir():
                continue
            skill_md = self._find_skill_md(entry)
            if not skill_md:
                continue
            try:
                content = skill_md.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            try:
                parsed = YAMLParser.parse(content)
                metadata = parsed["metadata"]
            except (ValueError, KeyError):
                metadata = {}
            file_count, total_size = self._compute_dir_stats(entry)
            skills.append(
                {
                    "name": entry.name,
                    "description": str(metadata.get("description", "")),
                    "size_bytes": total_size,
                    "file_count": file_count,
                }
            )
        return skills

    async def upload(
        self,
        file: UploadFile,
    ) -> CustomSkillDict:
        contents = await file.read()

        if len(contents) > MAX_SKILL_SIZE_BYTES:
            raise SkillException(
                f"Skill package too large (max {MAX_SKILL_SIZE_BYTES / 1024 / 1024}MB)"
            )

        try:
            with zipfile.ZipFile(io.BytesIO(contents)) as zf:
                metadata, file_count, total_size = self._validate_zip_structure(zf)
                skill_name = self.sanitize_name(metadata.get("name", ""))

                if self.resource_exists(skill_name):
                    raise SkillException(f"Skill '{skill_name}' already exists")

                skill_dir = self._get_skill_path(skill_name)
                if skill_dir.exists():
                    shutil.rmtree(skill_dir)
                skill_dir.mkdir(parents=True, exist_ok=True)

                skill_dir_resolved = skill_dir.resolve()
                archive_root = self._detect_archive_root(zf)
                for rel, file_bytes in self.iter_zip_entries(zf, archive_root):
                    dest = (skill_dir / rel).resolve()
                    if not dest.is_relative_to(skill_dir_resolved):
                        raise SkillException(f"Invalid file path in ZIP: {rel}")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(file_bytes)

                logger.info(
                    f"Stored skill: {skill_name}, size={total_size}, files={file_count}"
                )

        except zipfile.BadZipFile:
            raise SkillException("Invalid ZIP file")
        except SkillException:
            raise

        return {
            "name": skill_name,
            "description": metadata.get("description", ""),
            "size_bytes": total_size,
            "file_count": file_count,
        }

    async def delete(self, skill_name: str) -> None:
        skill_dir = self._get_skill_path(skill_name)
        if skill_dir.is_symlink():
            skill_dir.unlink()
        elif skill_dir.exists():
            shutil.rmtree(skill_dir)

    def get_all_skill_paths(self) -> list[EnabledResourceInfo]:
        if not self.skills_base_path.is_dir():
            return []
        resources: list[EnabledResourceInfo] = []
        for entry in self.skills_base_path.iterdir():
            if not entry.is_dir():
                continue
            if not self._find_skill_md(entry):
                continue
            resources.append({"name": entry.name, "path": str(entry)})
        return resources

    def get_files(
        self,
        skill_name: str,
    ) -> list[dict[str, str | bool]]:
        skill_dir = self._get_skill_path(skill_name)
        if not skill_dir.exists() or not skill_dir.is_dir():
            raise SkillException(f"Skill '{skill_name}' not found")

        files: list[dict[str, str | bool]] = []
        for file_path in sorted(skill_dir.rglob("*")):
            if not file_path.is_file():
                continue
            rel = str(file_path.relative_to(skill_dir))
            try:
                content = file_path.read_text(encoding="utf-8")
                files.append({"path": rel, "content": content, "is_binary": False})
            except UnicodeDecodeError:
                encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
                files.append({"path": rel, "content": encoded, "is_binary": True})
        return files

    def update(
        self,
        skill_name: str,
        files: list[dict[str, str | bool]],
    ) -> CustomSkillDict:
        skill_dir = self._get_skill_path(skill_name)
        if not skill_dir.exists() or not skill_dir.is_dir():
            raise SkillException(f"Skill '{skill_name}' not found")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp) / skill_name
            tmp_dir.mkdir()
            tmp_resolved = tmp_dir.resolve()
            for entry in files:
                rel_path = str(entry["path"])
                dest = (tmp_dir / rel_path).resolve()
                if not dest.is_relative_to(tmp_resolved):
                    raise SkillException(f"Invalid file path: {rel_path}")
                dest.parent.mkdir(parents=True, exist_ok=True)
                if entry.get("is_binary"):
                    data = base64.b64decode(str(entry["content"]))
                    dest.write_bytes(data)
                else:
                    dest.write_text(str(entry["content"]), encoding="utf-8")

            metadata, file_count, total_size = self._validate_skill_dir(tmp_dir)

            new_name = self.sanitize_name(str(metadata.get("name", "")))
            if new_name != skill_name:
                raise SkillException(
                    f"Cannot rename skill via edit ('{skill_name}' → '{new_name}'). "
                    "Delete and re-upload to rename."
                )

            # Replace old directory contents
            shutil.rmtree(skill_dir)
            shutil.copytree(tmp_dir, skill_dir)

        return {
            "name": skill_name,
            "description": metadata.get("description", ""),
            "size_bytes": total_size,
            "file_count": file_count,
        }
