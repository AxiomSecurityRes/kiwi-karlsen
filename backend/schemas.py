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


class ProfileUpdate(BaseModel):
    first_name: Optional[str] = Field(default=None, max_length=40)
    last_name: Optional[str] = Field(default=None, max_length=40)
    location: Optional[str] = Field(default=None, max_length=80)
    country: Optional[str] = Field(default=None, max_length=40)
    bio: Optional[str] = Field(default=None, max_length=1000)
    otb_rating: Optional[int] = Field(default=None, ge=0, le=3500)


class UsernameChange(BaseModel):
    new_username: str = Field(min_length=2, max_length=40)


class AdminUserUpdate(BaseModel):
    rating: Optional[float] = Field(default=None, ge=100, le=4000)
    is_admin: Optional[bool] = None
    banned: Optional[bool] = None
