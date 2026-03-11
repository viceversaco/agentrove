from typing import Literal, cast

from app.models.types import CustomAgentDict, YamlMetadata
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
            "allowed_tools": metadata.get("allowed_tools"),
            "model": valid_model,
        }
