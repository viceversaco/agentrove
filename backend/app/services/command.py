from app.models.types import CustomSlashCommandDict, YamlMetadata
from app.services.claude_folder_sync import ClaudeFolderSync
from app.services.resource import BaseMarkdownResourceService
from app.services.exceptions import CommandException


class CommandService(BaseMarkdownResourceService[CustomSlashCommandDict]):
    resource_type = "Command"
    exception_class = CommandException

    def _get_storage_folder(self) -> str:
        return "commands"

    def _validate_additional_fields(self, metadata: YamlMetadata) -> None:
        arg_hint = metadata.get("argument_hint")
        if arg_hint and len(arg_hint) > 100:
            self._raise("argument_hint too long (max 100 characters)")

    def _sync_write_to_claude_folder(self, name: str, content: str) -> None:
        if ClaudeFolderSync.is_active():
            ClaudeFolderSync.write_command(name, content)

    def _sync_delete_from_claude_folder(self, name: str) -> None:
        if ClaudeFolderSync.is_active():
            ClaudeFolderSync.delete_command(name)

    def _build_response(
        self, name: str, metadata: YamlMetadata, content: str
    ) -> CustomSlashCommandDict:
        return {
            "name": name,
            "description": metadata.get("description", ""),
            "content": content,
            "enabled": True,
            "argument_hint": metadata.get("argument_hint"),
            "allowed_tools": metadata.get("allowed_tools"),
            "model": None,
        }
