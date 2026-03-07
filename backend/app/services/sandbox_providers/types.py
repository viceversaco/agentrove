from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Coroutine

PtyDataCallbackType = Callable[[bytes], Coroutine[Any, Any, None]]


class SandboxProviderType(str, Enum):
    DOCKER = "docker"
    HOST = "host"


@dataclass
class CommandResult:
    stdout: str
    stderr: str
    exit_code: int


@dataclass
class FileMetadata:
    path: str
    type: str
    size: int
    modified: float
    is_binary: bool = False


@dataclass
class FileContent:
    path: str
    content: str
    type: str
    is_binary: bool


@dataclass
class PtySession:
    id: str
    pid: int | None
    rows: int
    cols: int


@dataclass
class PtySize:
    rows: int
    cols: int


@dataclass
class PreviewLink:
    preview_url: str
    port: int


@dataclass
class SecretEntry:
    key: str
    value: str


@dataclass
class DockerConfig:
    image: str = "agentrove-sandbox:latest"
    network: str = "agentrove-sandbox-net"
    host: str | None = None
    preview_base_url: str = "http://localhost"
    user_home: str = "/home/user"
    openvscode_port: int = 8765
    traefik_network: str = ""
    traefik_entrypoint: str = "https"
    runtime: str = ""
    mem_limit: str = ""
    cpu_period: int = 0
    cpu_quota: int = 0
    pids_limit: int = 0
