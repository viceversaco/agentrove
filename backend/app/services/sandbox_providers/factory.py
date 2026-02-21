from app.core.config import get_settings
from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import SandboxProvider
from app.services.sandbox_providers.docker_provider import LocalDockerProvider
from app.services.sandbox_providers.e2b_provider import E2BSandboxProvider
from app.services.sandbox_providers.host_provider import LocalHostProvider
from app.services.sandbox_providers.modal_provider import ModalSandboxProvider
from app.services.sandbox_providers.types import DockerConfig, SandboxProviderType

settings = get_settings()


class SandboxProviderFactory:
    @staticmethod
    def create_docker_config() -> DockerConfig:
        return DockerConfig(
            image=settings.DOCKER_IMAGE,
            network=settings.DOCKER_NETWORK,
            host=settings.DOCKER_HOST,
            preview_base_url=settings.DOCKER_PREVIEW_BASE_URL,
            traefik_network=settings.DOCKER_TRAEFIK_NETWORK,
            traefik_entrypoint=settings.DOCKER_TRAEFIK_ENTRYPOINT,
            runtime=settings.DOCKER_RUNTIME,
            mem_limit=settings.DOCKER_MEM_LIMIT,
            cpu_period=settings.DOCKER_CPU_PERIOD,
            cpu_quota=settings.DOCKER_CPU_QUOTA,
            pids_limit=settings.DOCKER_PIDS_LIMIT,
        )

    @staticmethod
    def create(
        provider_type: SandboxProviderType | str,
        api_key: str | None = None,
    ) -> SandboxProvider:
        if isinstance(provider_type, str):
            provider_type = SandboxProviderType(provider_type)

        if provider_type == SandboxProviderType.E2B:
            if not api_key:
                raise SandboxException("E2B API key is required")
            return E2BSandboxProvider(api_key=api_key)

        if provider_type == SandboxProviderType.DOCKER:
            return LocalDockerProvider(
                config=SandboxProviderFactory.create_docker_config()
            )

        if provider_type == SandboxProviderType.MODAL:
            if not api_key:
                raise SandboxException("Modal API key is required")
            return ModalSandboxProvider(api_key=api_key)

        if provider_type == SandboxProviderType.HOST:
            host_base_dir = settings.get_host_sandbox_base_dir()
            return LocalHostProvider(
                base_dir=host_base_dir,
                preview_base_url=settings.HOST_PREVIEW_BASE_URL,
            )

        raise ValueError(f"Unknown provider type: {provider_type}")

    @staticmethod
    def resolve_api_key(
        provider_type: SandboxProviderType | str,
        e2b_api_key: str | None,
        modal_api_key: str | None,
    ) -> str | None:
        if isinstance(provider_type, str):
            provider_type = SandboxProviderType(provider_type)

        if provider_type == SandboxProviderType.E2B:
            return e2b_api_key
        if provider_type == SandboxProviderType.MODAL:
            return modal_api_key
        return None
