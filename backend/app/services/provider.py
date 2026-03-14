from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from app.models.db_models.user import UserSettings


class ProviderService:
    def _is_model_enabled(self, provider: dict[str, Any], model_id: str) -> bool:
        for model in provider.get("models", []):
            if model.get("model_id") == model_id:
                return bool(model.get("enabled", True))
        return False

    def get_all_models(self, user_settings: "UserSettings") -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for provider in list(user_settings.custom_providers or []):
            if not provider.get("enabled", True):
                continue
            provider_id = provider.get("id")
            provider_name = provider.get("name")
            raw_provider_type = provider.get("provider_type", "custom")
            provider_type = (
                raw_provider_type.value
                if hasattr(raw_provider_type, "value")
                else raw_provider_type
            )
            for model in provider.get("models", []):
                if not model.get("enabled", True):
                    continue
                model_id = model.get("model_id")
                result.append(
                    {
                        "model_id": f"{provider_id}:{model_id}",
                        "name": model.get("name"),
                        "provider_id": provider_id,
                        "provider_name": provider_name,
                        "provider_type": provider_type,
                        "context_window": model.get("context_window"),
                    }
                )
        return result

    def find_provider_by_id(
        self, user_settings: "UserSettings", provider_id: str
    ) -> dict[str, Any] | None:
        for provider in list(user_settings.custom_providers or []):
            if provider.get("id") == provider_id:
                return cast(dict[str, Any], provider)
        return None

    def get_provider_for_model(
        self, user_settings: "UserSettings", model_id: str
    ) -> tuple[dict[str, Any] | None, str]:
        if ":" in model_id:
            provider_id, actual_model_id = model_id.split(":", 1)
            provider = self.find_provider_by_id(user_settings, provider_id)
            if provider and provider.get("enabled", True):
                if self._is_model_enabled(provider, actual_model_id):
                    return provider, actual_model_id
            return None, actual_model_id

        for provider in list(user_settings.custom_providers or []):
            if not provider.get("enabled", True):
                continue
            for model in provider.get("models", []):
                if model.get("enabled", True) and model.get("model_id") == model_id:
                    return provider, model_id

        return None, model_id

    def get_model_context_window(
        self, user_settings: "UserSettings", model_id: str
    ) -> int | None:
        provider, actual_model_id = self.get_provider_for_model(user_settings, model_id)
        if not provider:
            return None
        for model in provider.get("models", []):
            if model.get("model_id") == actual_model_id:
                ctx: int | None = model.get("context_window")
                return ctx
        return None
