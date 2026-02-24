from app.services.transports.docker import DockerSandboxTransport
from app.services.transports.host import HostSandboxTransport

SandboxTransport = DockerSandboxTransport | HostSandboxTransport

__all__ = [
    "DockerSandboxTransport",
    "HostSandboxTransport",
    "SandboxTransport",
]
