from claude_agent_sdk.types import ClaudeAgentOptions

from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.transports.docker import DockerSandboxTransport
from app.services.transports.host import HostSandboxTransport

SandboxTransport = DockerSandboxTransport | HostSandboxTransport


def create_sandbox_transport(
    sandbox_provider: str,
    sandbox_id: str,
    workspace_path: str | None,
    options: ClaudeAgentOptions,
) -> SandboxTransport:
    if (
        sandbox_provider == SandboxProviderType.DOCKER
        or sandbox_provider == SandboxProviderType.DOCKER.value
    ):
        docker_config = SandboxProviderFactory.create_docker_config()
        return DockerSandboxTransport(
            sandbox_id=sandbox_id,
            docker_config=docker_config,
            options=options,
        )

    if sandbox_provider == SandboxProviderType.HOST.value:
        return HostSandboxTransport(
            sandbox_id=sandbox_id,
            workspace_path=workspace_path,
            options=options,
        )

    raise ValueError(f"Unknown sandbox provider: {sandbox_provider}")
