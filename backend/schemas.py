from typing import Any, Optional

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
    rated: bool = True   # 레이팅 반영 여부 (연습 모드는 False)


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


class AdminStreakUpdate(BaseModel):
    current: Optional[int] = Field(default=None, ge=0, le=100000)
    best: Optional[int] = Field(default=None, ge=0, le=100000)
    last: Optional[str] = Field(default=None, max_length=10)  # 'YYYY-MM-DD' 또는 ''


class AdminStatsUpdate(BaseModel):
    wins: Optional[int] = Field(default=None, ge=0, le=1000000)
    losses: Optional[int] = Field(default=None, ge=0, le=1000000)
    draws: Optional[int] = Field(default=None, ge=0, le=1000000)
    rating: Optional[float] = Field(default=None, ge=100, le=4000)
    rd: Optional[float] = Field(default=None, ge=10, le=500)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class AdminFriendAdd(BaseModel):
    user_a: int
    user_b: int


class SettingUpdate(BaseModel):
    key: str = Field(max_length=60)
    value: Any = None


class AnnounceBody(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class DailySolveBody(BaseModel):
    success: bool
    seconds: int = Field(default=0, ge=0, le=86400)


class RushResultBody(BaseModel):
    mode: str = Field(max_length=12)
    score: int = Field(ge=0, le=500)
    misses: int = Field(default=0, ge=0, le=100)
