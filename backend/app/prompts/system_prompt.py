from datetime import datetime
from typing import TYPE_CHECKING

from app.constants import DOCKER_AVAILABLE_PORTS
from app.services.sandbox_providers import SandboxProviderType

if TYPE_CHECKING:
    from app.models.db_models.user import UserSettings


class SystemPromptBuilder:
    @staticmethod
    def github_section(github_token_configured: bool) -> str:
        if not github_token_configured:
            return ""
        return """
<github_integration>
- Use `gh` CLI for GitHub operations (PRs, issues, API)
- Examples: `gh pr list`, `gh pr view 193 --json number,title,body,headRefName,baseRefName,commits`, `gh pr diff 193` (where 193 is PR number)
- Commit messages should reference test/issue IDs when applicable
</github_integration>
"""

    @staticmethod
    def env_vars_section(env_vars_formatted: str | None) -> str:
        if not env_vars_formatted:
            return ""
        return f"""

<available_env_variables>
- Available custom environment variables: {env_vars_formatted}
- Use these directly without prompting users for API keys or credentials
- Already set in the sandbox environment and ready for immediate use
</available_env_variables>
"""

    @staticmethod
    def prompt_suggestions_section() -> str:
        return """
<prompt_suggestions_instructions>
At the end of EVERY response, you MUST provide 2-3 contextually relevant follow-up prompt suggestions.
These suggestions should help the user continue the conversation productively.

Format your suggestions as follows, placing them at the VERY END of your response:
<prompt_suggestions>
["First suggestion", "Second suggestion", "Third suggestion"]
</prompt_suggestions>

Guidelines for suggestions:
- Make them concise and actionable (under 50 characters each)
- Relate them directly to what was just discussed
- Offer different directions the user might want to explore
- For coding tasks: suggest next steps like testing, optimization, or related features
- For questions: suggest follow-up questions or related topics
</prompt_suggestions_instructions>
"""

    @staticmethod
    def runtime_context_section(
        sandbox_id: str,
        current_date: str,
        sandbox_provider: str = "docker",
    ) -> str:
        ports_str = ", ".join(str(p) for p in DOCKER_AVAILABLE_PORTS)
        if sandbox_provider == SandboxProviderType.E2B.value:
            provider_label = "E2B (cloud)"
        elif sandbox_provider == SandboxProviderType.MODAL.value:
            provider_label = "Modal (cloud)"
        elif sandbox_provider == SandboxProviderType.HOST.value:
            provider_label = "Host (local machine)"
        else:
            provider_label = "Docker (local)"
        return f"""<runtime_context>
- Workspace: /home/user
- Sandbox: {sandbox_id}
- Date: {current_date}
- Sandbox Provider: {provider_label}
- Available ports for dev servers: {ports_str}
- IMPORTANT: Only use ports from the available ports list above. Other ports will not be accessible.
- IMPORTANT: For sandbox providers (Docker/E2B/Modal), ensure dev servers bind to all interfaces and allow external hosts:
  - Set `host: "0.0.0.0"` in the framework config (e.g., Vite `server.host`).
  - Set `allowedHosts: true` in the framework config (e.g., Vite `server.allowedHosts`).
- IMPORTANT: Do NOT tell users specific localhost URLs. The actual port is dynamically mapped. Direct users to check the Preview panel for the correct URL.
</runtime_context>"""

    @staticmethod
    def build(
        sandbox_id: str,
        github_token_configured: bool = False,
        env_vars_formatted: str | None = None,
        sandbox_provider: str = "docker",
        custom_prompt_content: str | None = None,
    ) -> str:
        current_date = datetime.utcnow().strftime("%Y-%m-%d")
        runtime_section = SystemPromptBuilder.runtime_context_section(
            sandbox_id, current_date, sandbox_provider
        )
        github_section = SystemPromptBuilder.github_section(github_token_configured)
        env_section = SystemPromptBuilder.env_vars_section(env_vars_formatted)
        suggestions_section = SystemPromptBuilder.prompt_suggestions_section()

        custom_section = f"\n{custom_prompt_content}\n" if custom_prompt_content else ""

        return f"""
{custom_section}
{runtime_section}

{github_section}

{env_section}

{suggestions_section}
"""


def build_system_prompt_for_chat(
    sandbox_id: str,
    user_settings: "UserSettings",
    selected_prompt_name: str | None = None,
) -> str:
    github_token_configured = bool(user_settings.github_personal_access_token)
    env_vars_formatted = None
    if user_settings.custom_env_vars:
        env_vars_formatted = "\n".join(
            f"- {env_var['key']}" for env_var in user_settings.custom_env_vars
        )

    sandbox_provider = user_settings.sandbox_provider

    custom_prompt_content = None
    if selected_prompt_name and user_settings.custom_prompts:
        custom_prompt = next(
            (
                p
                for p in user_settings.custom_prompts
                if p.get("name") == selected_prompt_name
            ),
            None,
        )
        if custom_prompt:
            custom_prompt_content = custom_prompt["content"]

    return SystemPromptBuilder.build(
        sandbox_id,
        github_token_configured,
        env_vars_formatted,
        sandbox_provider,
        custom_prompt_content=custom_prompt_content,
    )
