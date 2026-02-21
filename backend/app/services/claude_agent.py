import logging
from collections.abc import AsyncIterator, Callable
from functools import partial
from typing import Any, Literal, NamedTuple

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    ResultMessage,
)

from app.constants import SANDBOX_GIT_ASKPASS_PATH, SANDBOX_HOME_DIR
from app.core.config import get_settings
from app.core.security import create_chat_scoped_token
from app.db.session import SessionLocal
from app.models.db_models import Chat, MessageRole, User, UserSettings
from app.models.schemas.settings import ProviderType
from app.prompts.enhance_prompt import ENHANCE_PROMPT
from app.services.exceptions import ClaudeAgentException
from app.services.provider import ProviderService
from app.services.sandbox_providers import SandboxProviderType
from app.services.sandbox_providers.factory import SandboxProviderFactory
from app.services.streaming.processor import StreamProcessor
from app.services.streaming.types import StreamEvent
from app.services.tool_handler import ToolHandlerRegistry
from app.services.transports import (
    DockerSandboxTransport,
    E2BSandboxTransport,
    HostSandboxTransport,
    ModalSandboxTransport,
    SandboxTransport,
)
from app.services.user import UserService

settings = get_settings()
logger = logging.getLogger(__name__)

THINKING_MODE_TOKENS = {
    "low": 4000,
    "medium": 10000,
    "high": 15000,
    "ultra": 32000,
}
ALLOWED_SLASH_COMMANDS = [
    "/context",
    "/compact",
    "/pr-comments",
    "/review",
    "/init",
]
SDK_PERMISSION_MODE_MAP: dict[
    str, Literal["default", "acceptEdits", "plan", "bypassPermissions"]
] = {
    "plan": "plan",
    "ask": "default",
    "auto": "bypassPermissions",
}


class SessionParams(NamedTuple):
    options: ClaudeAgentOptions
    sandbox_id: str
    sandbox_provider: str
    transport_factory: Callable[[], SandboxTransport]


MCP_TYPE_CONFIGS: dict[str, dict[str, Any]] = {
    "npx": {
        "command": "npx",
        "required_field": "package",
        "args_prefix": ("-y",),
    },
    "bunx": {
        "command": "bunx",
        "required_field": "package",
        "args_prefix": (),
    },
    "uvx": {
        "command": "uvx",
        "required_field": "package",
        "args_prefix": (),
    },
    "http": {
        "type": "http",
        "required_field": "url",
        "is_http": True,
    },
}


class SessionHandler:
    def __init__(self, session_callback: Callable[[str], None] | None) -> None:
        self.session_callback = session_callback

    def __call__(self, new_session_id: str) -> None:
        if self.session_callback:
            self.session_callback(new_session_id)


class ClaudeAgentService:
    def __init__(self, session_factory: Callable[..., Any] | None = None) -> None:
        self.tool_registry = ToolHandlerRegistry()
        self.session_factory = session_factory or SessionLocal
        self._total_cost_usd = 0.0
        self._usage: dict[str, Any] | None = None
        self._provider_service = ProviderService()

    def _create_sandbox_transport(
        self,
        sandbox_provider: str,
        sandbox_id: str,
        options: ClaudeAgentOptions,
        user_settings: UserSettings,
    ) -> (
        E2BSandboxTransport
        | DockerSandboxTransport
        | HostSandboxTransport
        | ModalSandboxTransport
    ):
        if (
            sandbox_provider == SandboxProviderType.DOCKER
            or sandbox_provider == SandboxProviderType.DOCKER.value
            or not sandbox_provider
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
                options=options,
            )

        if sandbox_provider == SandboxProviderType.MODAL.value:
            if not user_settings.modal_api_key:
                raise ClaudeAgentException(
                    "Modal API key is required for Modal sandbox provider"
                )

            return ModalSandboxTransport(
                sandbox_id=sandbox_id,
                api_key=user_settings.modal_api_key,
                options=options,
            )

        if not user_settings.e2b_api_key:
            raise ClaudeAgentException(
                "E2B API key is required for E2B sandbox provider"
            )

        return E2BSandboxTransport(
            sandbox_id=sandbox_id,
            api_key=user_settings.e2b_api_key,
            options=options,
        )

    async def build_session_params(
        self,
        *,
        user: User,
        chat: Chat,
        system_prompt: str,
        custom_instructions: str | None,
        model_id: str,
        permission_mode: str,
        session_id: str | None,
        thinking_mode: str | None,
        is_custom_prompt: bool,
    ) -> SessionParams:
        chat_id = str(chat.id)
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        sandbox_provider = user_settings.sandbox_provider
        sandbox_id = chat.sandbox_id
        if not sandbox_id:
            raise ClaudeAgentException(
                "Chat does not have an associated sandbox environment"
            )
        sandbox_id_str = str(sandbox_id)

        options = await self._build_claude_options(
            user=user,
            user_settings=user_settings,
            system_prompt=system_prompt,
            permission_mode=permission_mode,
            model_id=model_id,
            session_id=session_id,
            thinking_mode=thinking_mode,
            chat_id=chat_id,
            is_custom_prompt=is_custom_prompt,
        )

        transport_factory = partial(
            self._create_sandbox_transport,
            sandbox_provider=sandbox_provider,
            sandbox_id=sandbox_id_str,
            options=options,
            user_settings=user_settings,
        )

        return SessionParams(
            options=options,
            sandbox_id=sandbox_id_str,
            sandbox_provider=sandbox_provider,
            transport_factory=transport_factory,
        )

    async def stream_with_client(
        self,
        client: ClaudeSDKClient,
        prompt: str,
        custom_instructions: str | None,
        session_id: str | None,
        session_callback: Callable[[str], None] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        self._total_cost_usd = 0.0
        self._usage = None
        user_prompt = self.prepare_user_prompt(prompt, custom_instructions, attachments)

        prompt_message = {
            "type": "user",
            "message": {"role": MessageRole.USER.value, "content": user_prompt},
            "parent_tool_use_id": None,
            "session_id": session_id,
        }
        prompt_iterable = self._create_prompt_iterable(prompt_message)

        processor = StreamProcessor(
            tool_registry=self.tool_registry,
            session_handler=self._create_session_handler(session_callback),
        )

        try:
            await client.query(prompt_iterable)
            async for message in client.receive_response():
                prev_usage = processor.usage
                for event in processor.emit_events_for_message(message):
                    if event:
                        yield event
                        event_type = event.get("type")
                        if event_type == "tool_completed":
                            tool_name = event.get("tool", {}).get("name")
                            if tool_name == "ExitPlanMode":
                                await client.set_permission_mode("auto")
                            elif tool_name == "EnterPlanMode":
                                await client.set_permission_mode("plan")
                        elif event_type == "tool_failed":
                            tool_name = event.get("tool", {}).get("name")
                            if tool_name == "ExitPlanMode":
                                await client.set_permission_mode("plan")
                            elif tool_name == "EnterPlanMode":
                                await client.set_permission_mode("auto")
                if processor.usage is not prev_usage:
                    self._usage = processor.usage

            self._total_cost_usd = processor.total_cost_usd
            self._usage = processor.usage

        except ClaudeSDKError as e:
            raise ClaudeAgentException(f"Claude SDK error: {str(e)}") from e

    def get_total_cost_usd(self) -> float:
        return self._total_cost_usd

    def get_usage(self) -> dict[str, Any] | None:
        return self._usage

    def _create_session_handler(
        self, session_callback: Callable[[str], None] | None
    ) -> SessionHandler:
        return SessionHandler(session_callback)

    def _build_auth_env(
        self, model_id: str, user_settings: UserSettings
    ) -> tuple[dict[str, str], str | None]:
        provider, actual_model_id = self._provider_service.get_provider_for_model(
            user_settings, model_id
        )

        env: dict[str, str] = {}
        if not provider:
            return env, None

        provider_type = provider.get("provider_type", "custom")
        auth_token = provider.get("auth_token")

        if provider_type == ProviderType.ANTHROPIC.value:
            if auth_token:
                env["CLAUDE_CODE_OAUTH_TOKEN"] = auth_token
        elif provider_type in (
            ProviderType.OPENROUTER.value,
            ProviderType.OPENAI.value,
        ):
            if auth_token and provider_type == ProviderType.OPENROUTER.value:
                env["OPENROUTER_API_KEY"] = auth_token
            env["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:3456"
            env["ANTHROPIC_AUTH_TOKEN"] = "placeholder"
            env["CLAUDE_CODE_SUBAGENT_MODEL"] = actual_model_id
        elif provider_type == ProviderType.COPILOT.value:
            if auth_token:
                env["GITHUB_COPILOT_TOKEN"] = auth_token
            env["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:3456"
            env["ANTHROPIC_AUTH_TOKEN"] = "placeholder"
            env["CLAUDE_CODE_SUBAGENT_MODEL"] = actual_model_id
        elif provider_type == ProviderType.CUSTOM.value:
            if provider.get("base_url"):
                env["ANTHROPIC_BASE_URL"] = provider["base_url"]
            if auth_token:
                env["ANTHROPIC_AUTH_TOKEN"] = auth_token

        return env, provider_type

    async def enhance_prompt(self, prompt: str, model_id: str, user: User) -> str:
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        _, actual_model_id = self._provider_service.get_provider_for_model(
            user_settings, model_id
        )

        env, _ = self._build_auth_env(model_id, user_settings)

        options = ClaudeAgentOptions(
            system_prompt=ENHANCE_PROMPT,
            permission_mode="bypassPermissions",
            model=actual_model_id,
            max_turns=1,
            env=env,
        )

        enhanced_text = ""
        try:
            async with ClaudeSDKClient(options=options) as client:
                await client.query(f"Enhance this prompt: {prompt}")
                async for message in client.receive_response():
                    if isinstance(message, ResultMessage) and message.result:
                        enhanced_text = message.result

            return enhanced_text or prompt

        except ClaudeSDKError as e:
            raise ClaudeAgentException(f"Failed to enhance prompt: {str(e)}")

    def _build_permission_server(
        self, permission_mode: str, chat_id: str, sandbox_provider: str = "docker"
    ) -> dict[str, Any]:
        chat_token = create_chat_scoped_token(chat_id)

        if sandbox_provider == SandboxProviderType.HOST.value:
            api_base_url = (
                settings.HOST_PERMISSION_API_URL.rstrip("/")
                if settings.HOST_PERMISSION_API_URL
                else settings.BASE_URL.rstrip("/")
            )
        elif settings.DOCKER_PERMISSION_API_URL:
            api_base_url = settings.DOCKER_PERMISSION_API_URL
        elif sandbox_provider in (
            SandboxProviderType.E2B.value,
            SandboxProviderType.MODAL.value,
        ):
            api_base_url = settings.BASE_URL.rstrip("/")
        else:
            base_url = settings.BASE_URL
            port = (
                base_url.rsplit(":", maxsplit=1)[-1].rstrip("/")
                if ":" in base_url
                else "8080"
            )
            api_base_url = f"http://host.docker.internal:{port}"

        return {
            "command": "python3",
            "args": ["-u", "/usr/local/bin/permission_server.py"],
            "env": {
                "PYTHONUNBUFFERED": "1",
                "PERMISSION_MODE": permission_mode,
                "API_BASE_URL": api_base_url,
                "CHAT_TOKEN": chat_token,
                "CHAT_ID": chat_id,
            },
        }

    def build_custom_mcps(self, custom_mcps: list[Any]) -> dict[str, Any]:
        servers = {}
        for mcp in custom_mcps:
            if not mcp.get("enabled", True):
                continue

            mcp_name = mcp.get("name")
            command_type = mcp.get("command_type")

            if not mcp_name or not command_type:
                continue

            try:
                servers[mcp_name] = self.build_mcp_config(mcp, command_type)
            except ClaudeAgentException as e:
                logger.error(
                    f"Failed to configure MCP '{mcp_name}': {e}", exc_info=True
                )
        return servers

    async def _get_mcp_servers(
        self,
        user: User,
        permission_mode: str,
        chat_id: str,
    ) -> dict[str, Any]:
        user_settings = await UserService(
            session_factory=self.session_factory
        ).get_user_settings(user.id)

        sandbox_provider = user_settings.sandbox_provider
        servers: dict[str, Any] = {}
        servers["permission"] = self._build_permission_server(
            permission_mode, chat_id, sandbox_provider
        )

        if user_settings.custom_mcps:
            servers.update(self.build_custom_mcps(user_settings.custom_mcps))

        if user_settings.gmail_oauth_tokens:
            servers["gmail"] = {
                "command": "gmail-mcp",
                "args": [],
            }

        return servers

    def build_mcp_config(
        self, mcp: dict[str, Any], command_type: str
    ) -> dict[str, Any]:
        type_config = MCP_TYPE_CONFIGS.get(command_type)
        if not type_config:
            raise ClaudeAgentException(f"Unknown MCP command type: {command_type}")

        mcp_name = mcp.get("name", "unknown")
        required_field = type_config["required_field"]

        if not mcp.get(required_field):
            raise ClaudeAgentException(
                f"{command_type.upper()} MCP '{mcp_name}' requires '{required_field}' field"
            )

        if type_config.get("is_http"):
            config = {
                "type": type_config["type"],
                "url": mcp[required_field],
            }
            if mcp.get("env_vars"):
                config["headers"] = mcp["env_vars"]
        else:
            args = list(type_config["args_prefix"]) + [mcp[required_field]]
            if mcp.get("args"):
                args.extend(mcp["args"])
            config = {
                "command": type_config["command"],
                "args": args,
            }
            if mcp.get("env_vars"):
                config["env"] = mcp["env_vars"]

        return config

    async def _build_claude_options(
        self,
        *,
        user: User,
        user_settings: UserSettings,
        system_prompt: str,
        permission_mode: str,
        model_id: str,
        session_id: str | None,
        thinking_mode: str | None,
        chat_id: str,
        is_custom_prompt: bool = False,
    ) -> ClaudeAgentOptions:
        env, provider_type = self._build_auth_env(model_id, user_settings)

        if user_settings.github_personal_access_token:
            env["GITHUB_TOKEN"] = user_settings.github_personal_access_token
            env["GIT_ASKPASS"] = SANDBOX_GIT_ASKPASS_PATH
            env["GIT_AUTHOR_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_AUTHOR_EMAIL"] = settings.GIT_AUTHOR_EMAIL
            env["GIT_COMMITTER_NAME"] = settings.GIT_AUTHOR_NAME
            env["GIT_COMMITTER_EMAIL"] = settings.GIT_AUTHOR_EMAIL

        if user_settings.custom_env_vars:
            for env_var in user_settings.custom_env_vars:
                env[env_var["key"]] = env_var["value"]

        disallowed_tools: list[str] = []
        if provider_type != ProviderType.ANTHROPIC.value:
            disallowed_tools.append("WebSearch")

        sdk_permission_mode = SDK_PERMISSION_MODE_MAP.get(
            permission_mode, "bypassPermissions"
        )

        system_prompt_config: str | dict[str, str]
        if is_custom_prompt:
            system_prompt_config = system_prompt
        else:
            system_prompt_config = {
                "type": "preset",
                "preset": "claude_code",
                "append": system_prompt,
            }

        _, actual_model_id = self._provider_service.get_provider_for_model(
            user_settings, model_id
        )

        options = ClaudeAgentOptions(
            system_prompt=system_prompt_config,
            permission_mode=sdk_permission_mode,
            model=actual_model_id,
            disallowed_tools=disallowed_tools,
            mcp_servers=await self._get_mcp_servers(
                user,
                permission_mode,
                chat_id,
            ),
            cwd=SANDBOX_HOME_DIR,
            user="user",
            resume=session_id,
            env=env,
            setting_sources=["local", "user", "project"],
            permission_prompt_tool_name="mcp__permission__approval_prompt",
        )

        if thinking_mode in THINKING_MODE_TOKENS:
            options.max_thinking_tokens = THINKING_MODE_TOKENS[thinking_mode]

        return options

    def prepare_user_prompt(
        self,
        prompt: str,
        custom_instructions: str | None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> str:
        if any(prompt.startswith(cmd) for cmd in ALLOWED_SLASH_COMMANDS):
            return prompt

        parts = []

        if custom_instructions and custom_instructions.strip():
            parts.append(
                f"<user_instructions>\n{custom_instructions.strip()}\n</user_instructions>\n\n"
            )

        if attachments:
            files_list = "\n".join(
                f"- {SANDBOX_HOME_DIR}/{attachment['file_path'].split('/')[-1]}"
                for attachment in attachments
            )
            parts.append(
                f"<user_attachments>\nUser uploaded the following files\n{files_list}\n</user_attachments>\n\n"
            )

        parts.append(f"<user_prompt>{prompt}</user_prompt>")
        return "".join(parts)

    @staticmethod
    async def _create_prompt_iterable(
        prompt_message: dict[str, Any],
    ) -> AsyncIterator[dict[str, Any]]:
        yield prompt_message
