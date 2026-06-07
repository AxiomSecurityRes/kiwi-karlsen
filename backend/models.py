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
