import asyncio
import io
import logging
import shlex
import tarfile
import uuid
from asyncio import AbstractEventLoop
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiodocker

from app.constants import (
    DOCKER_AVAILABLE_PORTS,
    DOCKER_STATUS_RUNNING,
    EXCLUDED_PREVIEW_PORTS,
    SANDBOX_DEFAULT_COMMAND_TIMEOUT,
    SANDBOX_HOME_DIR,
    TERMINAL_TYPE,
    VNC_WEBSOCKET_PORT,
)
from app.core.config import get_settings
from app.services.exceptions import SandboxException
from app.services.sandbox_providers.base import LISTENING_PORTS_COMMAND, SandboxProvider
from app.services.sandbox_providers.types import (
    CommandResult,
    DockerConfig,
    FileContent,
    FileMetadata,
    PreviewLink,
    PtyDataCallbackType,
    PtySession,
    PtySize,
)

logger = logging.getLogger(__name__)
settings = get_settings()

DOCKER_SANDBOX_CONTAINER_PREFIX = "claudex-sandbox-"


class LocalDockerProvider(SandboxProvider):
    def __init__(self, config: DockerConfig) -> None:
        self.config = config
        self._containers: dict[str, Any] = {}
        self._pty_sessions: dict[str, dict[str, Any]] = {}
        self._port_mappings: dict[str, dict[int, int]] = {}
        self._docker: aiodocker.Docker | None = None
        self._docker_loop: AbstractEventLoop | None = None

    @property
    def _has_path_routing(self) -> bool:
        return bool(
            self.config.traefik_network
            and urlparse(self.config.preview_base_url).hostname
        )

    async def _get_docker(self) -> aiodocker.Docker:
        loop = asyncio.get_running_loop()
        if self._docker is not None and self._docker_loop is not loop:
            try:
                await self._docker.close()
            except Exception:
                pass
            self._docker = None
            self._docker_loop = None
            self._containers.clear()
            self._pty_sessions.clear()

        if self._docker is None:
            try:
                if self.config.host:
                    self._docker = aiodocker.Docker(url=self.config.host)
                else:
                    self._docker = aiodocker.Docker()
                self._docker_loop = loop
            except Exception as e:
                raise SandboxException(f"Failed to connect to Docker: {e}")
        return self._docker

    def _build_traefik_labels(self, sandbox_id: str) -> dict[str, str]:
        parsed_base = urlparse(self.config.preview_base_url)
        preview_host = parsed_base.hostname
        if not preview_host or not self.config.traefik_network:
            return {}

        labels: dict[str, str] = {
            "traefik.enable": "true",
            "traefik.docker.network": self.config.traefik_network,
        }
        use_tls = "true" if parsed_base.scheme == "https" else "false"
        for port in DOCKER_AVAILABLE_PORTS:
            router_name = f"sandbox-{sandbox_id}-{port}"
            route_prefix = f"/sandbox/{sandbox_id}/{port}"
            middleware_name = f"{router_name}-strip"
            labels[f"traefik.http.routers.{router_name}.rule"] = (
                f"Host(`{preview_host}`) && PathPrefix(`{route_prefix}`)"
            )
            labels[f"traefik.http.routers.{router_name}.entrypoints"] = (
                self.config.traefik_entrypoint
            )
            labels[f"traefik.http.routers.{router_name}.tls"] = use_tls
            labels[f"traefik.http.routers.{router_name}.middlewares"] = middleware_name
            labels[f"traefik.http.routers.{router_name}.service"] = router_name
            labels[
                f"traefik.http.middlewares.{middleware_name}.stripprefix.prefixes"
            ] = route_prefix
            labels[f"traefik.http.services.{router_name}.loadbalancer.server.port"] = (
                str(port)
            )

        return labels

    @staticmethod
    def _parse_mem_limit(mem_str: str) -> int:
        mem_str = mem_str.strip().lower()
        if not mem_str:
            return 0
        multipliers = {"k": 1024, "m": 1024**2, "g": 1024**3}
        if mem_str[-1] in multipliers:
            return int(mem_str[:-1]) * multipliers[mem_str[-1]]
        return int(mem_str)

    @staticmethod
    def _resolve_host_path(workspace_dir: Path) -> Path:
        host_storage = settings.HOST_STORAGE_PATH
        if not host_storage:
            return workspace_dir
        storage = Path(settings.STORAGE_PATH).resolve()
        try:
            relative = workspace_dir.relative_to(storage)
        except ValueError:
            return workspace_dir
        return Path(host_storage).resolve() / relative

    async def _create_container(
        self,
        sandbox_id: str,
        image: str | None = None,
        workspace_path: str | None = None,
    ) -> Any:
        docker = await self._get_docker()
        labels = self._build_traefik_labels(sandbox_id)
        network = self.config.traefik_network or self.config.network

        exposed_ports: dict[str, dict[str, Any]] = {
            f"{port}/tcp": {} for port in DOCKER_AVAILABLE_PORTS
        }
        port_bindings: dict[str, list[dict[str, str]]] = {
            f"{port}/tcp": [{"HostPort": ""}] for port in DOCKER_AVAILABLE_PORTS
        }

        host_config: dict[str, Any] = {
            "PortBindings": port_bindings,
            "NetworkMode": network,
        }

        if self.config.runtime:
            host_config["Runtime"] = self.config.runtime
        else:
            host_config["Privileged"] = True
            host_config["SecurityOpt"] = ["no-new-privileges=false"]

        if self.config.mem_limit:
            host_config["Memory"] = self._parse_mem_limit(self.config.mem_limit)
        if self.config.cpu_period > 0:
            host_config["CpuPeriod"] = self.config.cpu_period
        if self.config.cpu_quota > 0:
            host_config["CpuQuota"] = self.config.cpu_quota
        if self.config.pids_limit > 0:
            host_config["PidsLimit"] = self.config.pids_limit

        workspace_mount_dir = f"{self.config.user_home}/workspace"
        if workspace_path:
            workspace_dir = Path(workspace_path).expanduser().resolve()
            bind_source = self._resolve_host_path(workspace_dir)
            host_config["Binds"] = [f"{bind_source}:{workspace_mount_dir}"]

        config: dict[str, Any] = {
            "Image": image or self.config.image,
            "Cmd": ["/bin/bash"],
            "Hostname": "sandbox",
            "User": "user",
            "WorkingDir": self.config.user_home,
            "OpenStdin": True,
            "Tty": True,
            "Labels": labels,
            "ExposedPorts": exposed_ports,
            "Env": [
                f"TERM={TERMINAL_TYPE}",
                f"HOME={self.config.user_home}",
                "USER=user",
                f"OPENVSCODE_PORT={self.config.openvscode_port}",
            ],
            "HostConfig": host_config,
        }

        container_name = f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{sandbox_id}"
        container = await docker.containers.create_or_replace(container_name, config)
        await container.start()
        return container

    async def create_sandbox(self, workspace_path: str | None = None) -> str:
        sandbox_id = str(uuid.uuid4())[:12]

        try:
            container = await self._create_container(
                sandbox_id, workspace_path=workspace_path
            )
            self._containers[sandbox_id] = container

            port_map = await self._extract_port_mappings(container)
            self._port_mappings[sandbox_id] = port_map

            return sandbox_id
        except Exception as e:
            raise SandboxException(f"Failed to create Docker sandbox: {e}")

    async def _extract_port_mappings(self, container: Any) -> dict[int, int]:
        info = await container.show()
        ports = info.get("NetworkSettings", {}).get("Ports", {}) or {}
        port_map: dict[int, int] = {}
        for container_port, host_bindings in ports.items():
            if host_bindings:
                host_port = host_bindings[0].get("HostPort")
                if host_port:
                    internal_port = int(container_port.split("/")[0])
                    port_map[internal_port] = int(host_port)
        return port_map

    async def _is_container_running(self, container: Any) -> bool:
        info = await container.show()
        status: str = info.get("State", {}).get("Status", "")
        return status == DOCKER_STATUS_RUNNING

    async def _get_container_by_id(self, sandbox_id: str) -> Any | None:
        docker = await self._get_docker()
        try:
            return await docker.containers.get(
                f"{DOCKER_SANDBOX_CONTAINER_PREFIX}{sandbox_id}"
            )
        except Exception:
            return None

    async def connect_sandbox(self, sandbox_id: str) -> bool:
        await self._get_docker()

        if sandbox_id in self._containers:
            container = self._containers[sandbox_id]

            if await self._is_container_running(container):
                return True
            del self._containers[sandbox_id]

        container = await self._get_container_by_id(sandbox_id)
        if container:
            self._containers[sandbox_id] = container
            self._port_mappings[sandbox_id] = await self._extract_port_mappings(
                container
            )
            return True

        return False

    async def delete_sandbox(self, sandbox_id: str) -> None:
        await self._get_docker()

        container = self._containers.get(sandbox_id)

        if not container:
            container = await self._get_container_by_id(sandbox_id)
            if not container:
                return

        await self._destroy_container(container)

        self._containers.pop(sandbox_id, None)
        self._port_mappings.pop(sandbox_id, None)

        logger.info("Successfully deleted Docker sandbox %s", sandbox_id)

    async def list_files(
        self,
        sandbox_id: str,
        path: str = SANDBOX_HOME_DIR,
        excluded_patterns: list[str] | None = None,
    ) -> list[FileMetadata]:
        target_path = path
        if path == SANDBOX_HOME_DIR:
            container = await self._get_container(sandbox_id)
            workspace_mount_dir = f"{self.config.user_home}/workspace"
            info = await container.show()
            mounts = info.get("Mounts", []) or []
            if any(mount.get("Destination") == workspace_mount_dir for mount in mounts):
                target_path = workspace_mount_dir
            else:
                excluded_patterns = list(excluded_patterns or [])
                excluded_patterns.append(".*")
        return await super().list_files(sandbox_id, target_path, excluded_patterns)

    async def is_running(self, sandbox_id: str) -> bool:
        await self._get_docker()

        container = self._containers.get(sandbox_id)
        if not container:
            connected = await self.connect_sandbox(sandbox_id)
            if not connected:
                return False
            container = self._containers[sandbox_id]

        return await self._is_container_running(container)

    async def _collect_exec_output(self, exec_obj: Any) -> tuple[int, str]:
        stream = exec_obj.start()
        output_parts: list[bytes] = []
        try:
            while True:
                msg = await stream.read_out()
                if msg is None:
                    break
                output_parts.append(msg.data)
        finally:
            try:
                await stream.close()
            except Exception:
                pass
        exec_info = await exec_obj.inspect()
        exit_code = exec_info.get("ExitCode", -1)
        output = b"".join(output_parts).decode("utf-8", errors="replace")
        return exit_code, output

    async def execute_command(
        self,
        sandbox_id: str,
        command: str,
        background: bool = False,
        envs: dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> CommandResult:
        container = await self._get_container(sandbox_id)
        env_list = [f"{k}={v}" for k, v in (envs or {}).items()]
        effective_timeout = timeout or SANDBOX_DEFAULT_COMMAND_TIMEOUT

        exec_obj = await container.exec(
            cmd=["bash", "-c", command],
            environment=env_list,
            workdir=self.config.user_home,
        )

        if background:
            await exec_obj.start(detach=True)
            return CommandResult(
                stdout="Background process started", stderr="", exit_code=0
            )

        exit_code, output_str = await self._execute_with_timeout(
            self._collect_exec_output(exec_obj),
            effective_timeout,
            f"Command execution timed out after {effective_timeout}s",
        )

        return CommandResult(stdout=output_str, stderr="", exit_code=exit_code)

    async def write_file(
        self,
        sandbox_id: str,
        path: str,
        content: str | bytes,
    ) -> None:
        container = await self._get_container(sandbox_id)
        normalized_path = self.normalize_path(path)

        content_bytes = content.encode("utf-8") if isinstance(content, str) else content

        tar_stream = io.BytesIO()
        with tarfile.open(fileobj=tar_stream, mode="w") as tar:
            file_data = io.BytesIO(content_bytes)
            info = tarfile.TarInfo(name=Path(normalized_path).name)
            info.size = len(content_bytes)
            info.uid = 1000
            info.gid = 1000
            info.uname = "user"
            info.gname = "user"
            tar.addfile(info, file_data)
        tar_stream.seek(0)

        parent_dir = str(Path(normalized_path).parent)
        mkdir_exec = await container.exec(
            cmd=["mkdir", "-p", parent_dir],
            user="1000:1000",
        )
        mkdir_exit_code, mkdir_output = await self._collect_exec_output(mkdir_exec)
        if mkdir_exit_code != 0:
            raise SandboxException(
                f"Failed to create directory {parent_dir}: {mkdir_output}"
            )
        await container.put_archive(parent_dir, tar_stream.read())

    async def read_file(
        self,
        sandbox_id: str,
        path: str,
    ) -> FileContent:
        container = await self._get_container(sandbox_id)
        normalized_path = self.normalize_path(path)

        tar_obj = await container.get_archive(normalized_path)

        content_bytes = b""
        members = tar_obj.getmembers()
        if members:
            f = tar_obj.extractfile(members[0])
            if f:
                content_bytes = f.read()

        content, is_binary = self._encode_file_content(path, content_bytes)

        return FileContent(
            path=path,
            content=content,
            type="file",
            is_binary=is_binary,
        )

    async def create_pty(
        self,
        sandbox_id: str,
        rows: int,
        cols: int,
        tmux_session: str,
        on_data: PtyDataCallbackType | None = None,
    ) -> PtySession:
        container = await self._get_container(sandbox_id)
        session_id = str(uuid.uuid4())

        cmd = [
            "bash",
            "-c",
            f"command -v tmux >/dev/null && tmux new -A -s {shlex.quote(tmux_session)} \\; set -g status off || exec bash",
        ]

        exec_obj = await container.exec(
            cmd=cmd,
            stdin=True,
            tty=True,
            environment={"TERM": TERMINAL_TYPE},
            workdir=self.config.user_home,
        )
        stream = exec_obj.start()
        await stream._init()

        self._register_pty_session(
            sandbox_id,
            session_id,
            {
                "exec": exec_obj,
                "stream": stream,
                "container": container,
                "on_data": on_data,
                "reader_task": None,
            },
        )

        if on_data:
            reader_task = asyncio.create_task(
                self._pty_reader(sandbox_id, session_id, stream, on_data)
            )
            self._pty_sessions[sandbox_id][session_id]["reader_task"] = reader_task

        if rows > 0 and cols > 0:
            await self.resize_pty(sandbox_id, session_id, PtySize(rows=rows, cols=cols))

        return PtySession(
            id=session_id,
            pid=None,
            rows=rows,
            cols=cols,
        )

    async def _pty_reader(
        self,
        sandbox_id: str,
        session_id: str,
        stream: Any,
        on_data: PtyDataCallbackType,
    ) -> None:
        try:
            while True:
                msg = await stream.read_out()
                if msg is None:
                    break
                await on_data(msg.data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("PTY reader error: %s", e)

    async def send_pty_input(
        self,
        sandbox_id: str,
        pty_id: str,
        data: bytes,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        stream = session.get("stream")
        if not stream:
            return

        await stream.write_in(data)

    async def resize_pty(
        self,
        sandbox_id: str,
        pty_id: str,
        size: PtySize,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        exec_obj = session.get("exec")
        if not exec_obj:
            return

        await exec_obj.resize(h=max(size.rows, 1), w=max(size.cols, 1))

    async def kill_pty(
        self,
        sandbox_id: str,
        pty_id: str,
    ) -> None:
        session = self._get_pty_session(sandbox_id, pty_id)
        if not session:
            return

        reader_task = session.get("reader_task")
        if reader_task:
            reader_task.cancel()
            try:
                await reader_task
            except asyncio.CancelledError:
                pass

        stream = session.get("stream")
        if stream:
            try:
                await stream.close()
            except Exception:
                pass

        self._cleanup_pty_session_tracking(sandbox_id, pty_id)

    async def get_preview_links(self, sandbox_id: str) -> list[PreviewLink]:
        await self._get_container(sandbox_id)

        result = await self.execute_command(
            sandbox_id,
            LISTENING_PORTS_COMMAND,
            timeout=5,
        )
        listening_ports = self._parse_listening_ports(result.stdout)

        port_map = self._port_mappings.get(sandbox_id, {})
        mapped_ports = {p for p in listening_ports if p in port_map}

        return self._build_preview_links(
            listening_ports=mapped_ports,
            url_builder=(
                (
                    lambda port: (
                        f"{self.config.preview_base_url.rstrip('/')}/sandbox/{sandbox_id}/{port}"
                    )
                )
                if self._has_path_routing
                else (lambda port: f"{self.config.preview_base_url}:{port_map[port]}")
            ),
            excluded_ports=EXCLUDED_PREVIEW_PORTS,
        )

    async def _destroy_container(self, container: Any) -> None:
        try:
            await container.stop(t=5)
        except Exception:
            pass
        try:
            await container.delete(force=True)
        except Exception:
            pass

    async def _ensure_running(self, container: Any) -> None:
        info = await container.show()
        if info["State"]["Status"] != DOCKER_STATUS_RUNNING:
            await container.start()

    async def _get_container(self, sandbox_id: str) -> Any:
        await self._get_docker()

        if sandbox_id not in self._containers:
            connected = await self.connect_sandbox(sandbox_id)
            if not connected:
                raise SandboxException(f"Container {sandbox_id} not found")

        container = self._containers[sandbox_id]
        await self._ensure_running(container)
        return container

    async def get_ide_url(self, sandbox_id: str) -> str | None:
        if self._has_path_routing:
            base_url = self.config.preview_base_url.rstrip("/")
            return f"{base_url}/sandbox/{sandbox_id}/{self.config.openvscode_port}/?folder={SANDBOX_HOME_DIR}"

        await self.connect_sandbox(sandbox_id)
        port_map = self._port_mappings.get(sandbox_id, {})
        host_port = port_map.get(self.config.openvscode_port)
        if not host_port:
            return None
        return f"{self.config.preview_base_url}:{host_port}/?folder={SANDBOX_HOME_DIR}"

    async def get_vnc_url(self, sandbox_id: str) -> str | None:
        if self._has_path_routing:
            base_url = (
                self.config.preview_base_url.rstrip("/")
                .replace("http://", "ws://", 1)
                .replace("https://", "wss://", 1)
            )
            return f"{base_url}/sandbox/{sandbox_id}/{VNC_WEBSOCKET_PORT}"

        await self.connect_sandbox(sandbox_id)
        port_map = self._port_mappings.get(sandbox_id, {})
        host_port = port_map.get(VNC_WEBSOCKET_PORT)
        if not host_port:
            return None
        base_url = self.config.preview_base_url.replace("http://", "ws://", 1).replace(
            "https://", "wss://", 1
        )
        return f"{base_url}:{host_port}"

    async def cleanup(self) -> None:
        await super().cleanup()
        if self._docker:
            await self._docker.close()
            self._docker = None
