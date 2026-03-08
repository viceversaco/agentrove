from typing import Literal, cast

from app.models.types import CustomAgentDict, YamlMetadata
from app.services.claude_folder_sync import ClaudeFolderSync
from app.services.resource import BaseMarkdownResourceService
from app.services.exceptions import AgentException

VALID_AGENT_MODELS = ["sonnet", "opus", "haiku", "inherit"]


class AgentService(BaseMarkdownResourceService[CustomAgentDict]):
    resource_type = "Agent"
    exception_class = AgentException
    valid_models = VALID_AGENT_MODELS

    def _get_storage_folder(self) -> str:
        return "agents"

    def _validate_additional_fields(self, metadata: YamlMetadata) -> None:
        pass

    def _sync_write_to_claude_folder(self, name: str, content: str) -> None:
        if ClaudeFolderSync.is_active():
            ClaudeFolderSync.write_agent(name, content)

    def _sync_delete_from_claude_folder(self, name: str) -> None:
        if ClaudeFolderSync.is_active():
            ClaudeFolderSync.delete_agent(name)

    def _build_response(
        self, name: str, metadata: YamlMetadata, content: str
    ) -> CustomAgentDict:
        model_value = metadata.get("model", "inherit")
        valid_model: Literal["sonnet", "opus", "haiku", "inherit"] = (
            cast(Literal["sonnet", "opus", "haiku", "inherit"], model_value)
            if model_value in ("sonnet", "opus", "haiku", "inherit")
            else "inherit"
        )
        return {
            "name": name,
            "description": metadata.get("description", ""),
            "content": content,
            "enabled": True,
            "allowed_tools": metadata.get("allowed_tools"),
            "model": valid_model,
        }
