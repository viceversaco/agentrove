from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.db_models.user import UserSettings

PROMPT_SUGGESTIONS_INSTRUCTIONS = """
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


def build_system_prompt_for_chat(
    user_settings: "UserSettings",
    selected_prompt_name: str | None = None,
) -> str:
    custom_prompt_content = ""
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
            custom_prompt_content = f"\n{custom_prompt['content']}\n"

    return f"{custom_prompt_content}\n{PROMPT_SUGGESTIONS_INSTRUCTIONS}"
