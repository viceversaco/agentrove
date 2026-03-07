from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services.provider import ProviderService

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.models.db_models.user import UserSettings


class APIKeyValidationError(ValueError):
    pass


def validate_model_api_keys(
    user_settings: "UserSettings",
    model_id: str,
) -> None:
    provider_service = ProviderService()
    provider, actual_model_id = provider_service.get_provider_for_model(
        user_settings, model_id
    )

    if not provider:
        raise APIKeyValidationError(
            f"No provider configured for model '{model_id}'. "
            "Please configure a provider in Settings > Providers."
        )

    if not provider.get("enabled", True):
        raise APIKeyValidationError(f"Provider '{provider.get('name')}' is disabled.")

    provider_type = provider.get("provider_type", "custom")
    # Anthropic provider doesn't require a token in host mode — the CLI
    # uses the user's existing login.  All other built-in providers still
    # need an explicit key.
    token_optional_types = {"anthropic"}
    if (
        provider_type not in ("custom", *token_optional_types)
        and not provider.get("auth_token")
    ):
        raise APIKeyValidationError(
            f"API key is required for provider '{provider.get('name')}'. "
            "Please configure it in Settings."
        )

    if provider_type == "custom" and not provider.get("base_url"):
        raise APIKeyValidationError(
            f"Base URL is required for custom provider '{provider.get('name')}'."
        )
