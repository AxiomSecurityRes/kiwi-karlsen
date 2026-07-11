from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: Optional[str] = Field(default=None, max_length=128)


class BotMoveRequest(BaseModel):
    fen: str
    level: Optional[int] = Field(default=None, ge=1, le=8)
    elo: Optional[int] = Field(default=None, ge=100, le=3200)


class PuzzleSolvedRequest(BaseModel):
    puzzle_id: str
    success: bool


class FriendRequestBody(BaseModel):
    username: str = Field(min_length=2, max_length=40)


class FriendRespondBody(BaseModel):
    request_id: int
    accept: bool


class DMBody(BaseModel):
    to_id: int
    text: str = Field(min_length=1, max_length=1000)
