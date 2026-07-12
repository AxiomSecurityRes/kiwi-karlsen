from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(40), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)

    # Glicko-2 상태
    rating = Column(Float, default=1500.0, nullable=False)
    rd = Column(Float, default=350.0, nullable=False)
    vol = Column(Float, default=0.06, nullable=False)

    wins = Column(Integer, default=0, nullable=False)
    losses = Column(Integer, default=0, nullable=False)
    draws = Column(Integer, default=0, nullable=False)

    # 스트릭(연속 활동 일수)
    streak_current = Column(Integer, default=0, nullable=False)
    streak_best = Column(Integer, default=0, nullable=False)
    streak_last = Column(String(10), default="", nullable=False)  # 'YYYY-MM-DD'

    # 프로필
    first_name = Column(String(40), default="", nullable=False)
    last_name = Column(String(40), default="", nullable=False)
    location = Column(String(80), default="", nullable=False)
    country = Column(String(40), default="", nullable=False)
    bio = Column(Text, default="", nullable=False)
    otb_rating = Column(Integer, default=0, nullable=False)
    username_changed_at = Column(DateTime, nullable=True)

    # 퍼즐 / 러시
    puzzle_rating = Column(Float, default=800.0, nullable=False)
    puzzles_solved = Column(Integer, default=0, nullable=False)
    puzzles_failed = Column(Integer, default=0, nullable=False)
    rush_best_3m = Column(Integer, default=0, nullable=False)
    rush_best_5m = Column(Integer, default=0, nullable=False)
    rush_best_survival = Column(Integer, default=0, nullable=False)

    # 관리자 / 제재
    is_admin = Column(Integer, default=0, nullable=False)  # 0/1
    banned = Column(Integer, default=0, nullable=False)    # 0/1

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def public_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "rating": round(self.rating),
            "rd": round(self.rd),
            "wins": self.wins,
            "losses": self.losses,
            "draws": self.draws,
            "games": self.wins + self.losses + self.draws,
            "streakCurrent": self.streak_current,
            "streakBest": self.streak_best,
            "firstName": self.first_name,
            "lastName": self.last_name,
            "location": self.location,
            "country": self.country,
            "bio": self.bio,
            "otbRating": self.otb_rating,
            "puzzleRating": round(self.puzzle_rating),
            "puzzlesSolved": self.puzzles_solved,
            "puzzlesFailed": self.puzzles_failed,
            "rushBest3m": self.rush_best_3m,
            "rushBest5m": self.rush_best_5m,
            "rushBestSurvival": self.rush_best_survival,
            "isAdmin": bool(self.is_admin),
            "createdAt": self.created_at.isoformat() if self.created_at else "",
        }


class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True, index=True)
    white_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    black_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    white_name = Column(String(40), nullable=False)
    black_name = Column(String(40), nullable=False)

    # 결과: "1-0", "0-1", "1/2-1/2"
    result = Column(String(10), nullable=False)
    reason = Column(String(40), nullable=False, default="")
    pgn = Column(Text, nullable=False, default="")

    white_rating_change = Column(Float, default=0.0)
    black_rating_change = Column(Float, default=0.0)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def summary_dict(self) -> dict:
        return {
            "id": self.id,
            "white": self.white_name,
            "black": self.black_name,
            "whiteId": self.white_id,
            "blackId": self.black_id,
            "result": self.result,
            "reason": self.reason,
            "createdAt": self.created_at.isoformat() if self.created_at else "",
        }


class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(Integer, primary_key=True, index=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    addressee_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(10), nullable=False, default="pending")  # pending | accepted
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "fromId": self.sender_id,
            "toId": self.recipient_id,
            "text": self.text,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class SecurityEvent(Base):
    """보안/이상행위 감사 로그. 개인정보 보호를 위해 IP는 해시로만 저장한다."""
    __tablename__ = "security_events"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(40), nullable=False, index=True)  # login_failed, rate_limited, bot_suspect ...
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    username = Column(String(40), default="", nullable=False)
    ip_hash = Column(String(32), default="", nullable=False, index=True)
    path = Column(String(120), default="", nullable=False)
    detail = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "userId": self.user_id,
            "username": self.username,
            "ipHash": self.ip_hash,
            "path": self.path,
            "detail": self.detail,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class SiteSetting(Base):
    """런타임 사이트 설정(관리자가 재배포 없이 변경). key/value 문자열 저장."""
    __tablename__ = "site_settings"

    key = Column(String(60), primary_key=True)
    value = Column(Text, default="", nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class AdminAction(Base):
    """관리자 행위 감사 로그 — 누가, 누구에게, 무엇을 했는지 전부 기록."""
    __tablename__ = "admin_actions"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    admin_name = Column(String(40), default="", nullable=False)
    action = Column(String(50), nullable=False, index=True)
    target_type = Column(String(20), default="", nullable=False)  # user / game / dm / friendship / site
    target_id = Column(String(40), default="", nullable=False)
    target_name = Column(String(40), default="", nullable=False)
    detail = Column(Text, default="", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "adminName": self.admin_name,
            "action": self.action,
            "targetType": self.target_type,
            "targetId": self.target_id,
            "targetName": self.target_name,
            "detail": self.detail,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class DailyPuzzle(Base):
    """날짜별 일일 퍼즐 (모든 사용자가 같은 문제)."""
    __tablename__ = "daily_puzzles"

    day = Column(String(10), primary_key=True)   # 'YYYY-MM-DD'
    puzzle_id = Column(String(40), nullable=False)


class DailySolve(Base):
    """일일 퍼즐 풀이 기록."""
    __tablename__ = "daily_solves"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    day = Column(String(10), nullable=False, index=True)
    success = Column(Integer, default=0, nullable=False)
    seconds = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class RushSession(Base):
    """퍼즐 러시 기록."""
    __tablename__ = "rush_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    mode = Column(String(12), nullable=False, index=True)  # 3m / 5m / survival
    score = Column(Integer, default=0, nullable=False)
    misses = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "mode": self.mode, "score": self.score,
            "misses": self.misses,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class Achievement(Base):
    """획득한 업적."""
    __tablename__ = "achievements"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code = Column(String(40), nullable=False, index=True)
    earned_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Notification(Base):
    """알림 (친구 요청, DM, 업적, 공지 등)."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(24), nullable=False)   # friend / dm / achievement / announce / game
    text = Column(String(300), nullable=False, default="")
    link = Column(String(120), default="", nullable=False)
    is_read = Column(Integer, default=0, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "text": self.text,
            "link": self.link, "read": bool(self.is_read),
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class PuzzleAttempt(Base):
    """퍼즐 채점 기록 — 같은 퍼즐이 중복 집계되지 않도록 보장한다."""
    __tablename__ = "puzzle_attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    puzzle_id = Column(String(40), nullable=False, index=True)
    success = Column(Integer, default=0, nullable=False)
    rating_change = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
