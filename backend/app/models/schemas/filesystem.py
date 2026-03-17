from typing import Literal

from pydantic import BaseModel, Field


class DirectoryEntry(BaseModel):
    name: str = Field(..., max_length=512)
    path: str = Field(..., max_length=4096)
    type: Literal["directory"] = "directory"


class DirectoryBrowseResponse(BaseModel):
    path: str
    parent: str | None
    entries: list[DirectoryEntry]
