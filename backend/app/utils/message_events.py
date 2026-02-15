import json
from typing import cast

from app.models.types import JSONDict


class MessageEventParser:
    @staticmethod
    def parse_event_log(content: str) -> list[JSONDict]:
        if not content or not content.strip():
            return []

        try:
            parsed = json.loads(content.strip())
            if isinstance(parsed, list):
                return cast(list[JSONDict], parsed)
            return []
        except (json.JSONDecodeError, ValueError):
            return []

    @staticmethod
    def extract_user_prompt(message_content: str) -> str:
        events = MessageEventParser.parse_event_log(message_content)

        if not events:
            return message_content

        user_text_parts: list[str] = []

        for event in events:
            event_type = event.get("type")

            if event_type == "user_text":
                text = event.get("text", "")
                user_text_parts.append(str(text) if text else "")

        user_prompt = "".join(user_text_parts)
        return user_prompt or message_content
