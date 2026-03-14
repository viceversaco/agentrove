from pydantic import BaseModel

from app.models.schemas.settings import ProviderType


class AIModelResponse(BaseModel):
    model_id: str
    name: str
    provider_id: str
    provider_name: str
    provider_type: ProviderType
    context_window: int | None = None
