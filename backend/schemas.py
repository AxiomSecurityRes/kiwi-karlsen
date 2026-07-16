from typing import Any, Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: Optional[str] = Field(default=None, max_length=128)


class BotMoveRequest(BaseModel):
    fen: str
    level: Optional[int] = Field(default=None, ge=1, le=11)
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


# ---------- 계정 보안 ----------
class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=8, max_length=128)
    acceptTerms: bool = False
    website: str = ""          # 허니팟(봇이 채우면 거부) — 사람에겐 보이지 않는 필드


class LoginRequest2FA(BaseModel):
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=1, max_length=128)
    code: Optional[str] = Field(default=None, max_length=16)   # TOTP 또는 백업 코드


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class TotpVerify(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class TotpDisable(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    confirm: str = Field(max_length=40)   # "삭제" 를 입력해야 진행


# ---------- 원시 dict 제거용 스키마 ----------
class ReviewMoveIn(BaseModel):
    ply: int = Field(default=0, ge=0, le=400)
    moveNo: int = Field(default=0, ge=0, le=200)
    color: str = Field(default="white", max_length=5)
    san: str = Field(default="", max_length=12)
    piece: str = Field(default="", max_length=1)
    from_: str = Field(default="", alias="from", max_length=2)
    to: str = Field(default="", max_length=2)
    classification: str = Field(default="good", max_length=12)
    accuracy: float = Field(default=0, ge=0, le=100)
    loss: float = Field(default=0, ge=0, le=100)
    phase: str = Field(default="middlegame", max_length=12)
    isCapture: bool = False
    isCastle: bool = False
    castleSide: Optional[str] = Field(default=None, max_length=6)
    isCheck: bool = False
    isPromotion: bool = False
    isBook: bool = False
    isBest: bool = False
    isTactic: bool = False
    tacticFound: bool = False

    model_config = {"populate_by_name": True, "extra": "ignore"}


class ReviewSave(BaseModel):
    gameId: Optional[int] = None
    color: str = Field(default="white", max_length=5)
    accuracy: float = Field(default=0, ge=0, le=100)
    estElo: int = Field(default=0, ge=0, le=4000)
    avgLoss: float = Field(default=0, ge=0, le=100)
    counts: dict = Field(default_factory=dict)
    tacticsTotal: int = Field(default=0, ge=0, le=400)
    tacticsFound: int = Field(default=0, ge=0, le=400)
    opponentAccuracy: float = Field(default=0, ge=0, le=100)
    moves: list[ReviewMoveIn] = Field(default_factory=list, max_length=400)


class ClubCreate(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    description: str = Field(default="", max_length=500)
    emoji: str = Field(default="🏰", max_length=8)
    isPublic: bool = True


class ClubRoleBody(BaseModel):
    userId: int = Field(ge=1)
    role: str = Field(default="member", max_length=10)


class ClubKickBody(BaseModel):
    userId: int = Field(ge=1)


class ClubPostBody(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(default="", max_length=3000)
    fen: str = Field(default="", max_length=120)
    pgn: str = Field(default="", max_length=4000)
    pinned: bool = False


class ClubPinBody(BaseModel):
    pinned: bool = False


class ClubMessageBody(BaseModel):
    text: str = Field(min_length=1, max_length=600)


class LearnResultBody(BaseModel):
    openingKey: str = Field(min_length=1, max_length=160)
    score: int = Field(default=0, ge=0, le=100)


class VisionResultBody(BaseModel):
    mode: str = Field(default="coords", max_length=12)
    score: int = Field(default=0, ge=0, le=300)
    misses: int = Field(default=0, ge=0, le=300)


class OpeningsBookBody(BaseModel):
    moves: list[str] = Field(default_factory=list, max_length=300)
