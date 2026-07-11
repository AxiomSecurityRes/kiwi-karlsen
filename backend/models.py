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
