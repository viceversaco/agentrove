import base64
from datetime import datetime
from uuid import UUID


class InvalidCursorError(ValueError):
    pass


class Cursor:
    @staticmethod
    def encode(created_at: datetime, id: UUID) -> str:
        return base64.urlsafe_b64encode(
            f"{created_at.isoformat()}|{id}".encode()
        ).decode()

    @staticmethod
    def decode(cursor: str) -> tuple[datetime, UUID]:
        try:
            decoded = base64.urlsafe_b64decode(cursor.encode()).decode()
            ts_str, id_str = decoded.split("|")
            return datetime.fromisoformat(ts_str), UUID(id_str)
        except (ValueError, UnicodeDecodeError):
            raise InvalidCursorError(f"Invalid cursor format: {cursor}")
