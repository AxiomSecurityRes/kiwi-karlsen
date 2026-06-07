from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: Optional[str] = Field(default=None, max_length=128)


class BotMoveRequest(BaseModel):
    fen: str
    level: int = Field(ge=1, le=8)


class PuzzleSolvedRequest(BaseModel):
    puzzle_id: str
    success: bool
