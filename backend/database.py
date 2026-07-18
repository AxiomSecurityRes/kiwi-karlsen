from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def init_db() -> None:
    """모든 테이블 생성 + 누락 컬럼 자동 마이그레이션(SQLite)."""
    from . import models  # noqa: F401  (모델 등록을 위해 import)
    Base.metadata.create_all(bind=engine)
    _migrate_columns()


def _migrate_columns() -> None:
    """기존 DB에 새로 추가된 컬럼이 없으면 ALTER TABLE 로 추가."""
    from sqlalchemy import text
    wanted = {
        "game_reviews": {
            "tactics_total": "INTEGER DEFAULT 0",
            "tactics_found": "INTEGER DEFAULT 0",
            "opponent_accuracy": "FLOAT DEFAULT 0",
            "result": "VARCHAR(6) DEFAULT ''",
            "end_phase": "VARCHAR(12) DEFAULT ''",
            "game_shape": "VARCHAR(16) DEFAULT ''",
        },
        "games": {
            "minutes": "INTEGER DEFAULT 0",
            "increment": "INTEGER DEFAULT 0",
            "ply_count": "INTEGER DEFAULT 0",
            "white_rating_after": "FLOAT DEFAULT 0",
            "black_rating_after": "FLOAT DEFAULT 0",
            "source": "VARCHAR(12) DEFAULT 'site'",
            "ext_id": "VARCHAR(80) DEFAULT ''",
            "opp_country": "VARCHAR(8) DEFAULT ''",
        },
        "users": {
            "chesscom_username": "VARCHAR(40) DEFAULT ''",
            "chesscom_synced_at": "DATETIME",
            "first_name": "VARCHAR(40) DEFAULT ''",
            "last_name": "VARCHAR(40) DEFAULT ''",
            "location": "VARCHAR(80) DEFAULT ''",
            "country": "VARCHAR(40) DEFAULT ''",
            "bio": "TEXT DEFAULT ''",
            "otb_rating": "INTEGER DEFAULT 0",
            "username_changed_at": "DATETIME",
            "is_admin": "INTEGER DEFAULT 0",
            "banned": "INTEGER DEFAULT 0",
            "puzzle_rating": "FLOAT DEFAULT 800",
            "puzzles_solved": "INTEGER DEFAULT 0",
            "puzzles_failed": "INTEGER DEFAULT 0",
            "rush_best_3m": "INTEGER DEFAULT 0",
            "rush_best_5m": "INTEGER DEFAULT 0",
            "rush_best_survival": "INTEGER DEFAULT 0",
            "battle_wins": "INTEGER DEFAULT 0",
            "battle_losses": "INTEGER DEFAULT 0",
            "vision_best_coords": "INTEGER DEFAULT 0",
            "vision_best_moves": "INTEGER DEFAULT 0",
            "token_version": "INTEGER DEFAULT 1",
            "totp_secret": "VARCHAR(64) DEFAULT ''",
            "totp_enabled": "INTEGER DEFAULT 0",
            "backup_codes": "TEXT DEFAULT ''",
            "terms_accepted_at": "DATETIME",
            "last_login_at": "DATETIME",
            "password_changed_at": "DATETIME",
        },
    }
    try:
        with engine.begin() as conn:
            for table, cols in wanted.items():
                try:
                    existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
                except Exception:
                    continue
                for col, ddl in cols.items():
                    if col not in existing:
                        try:
                            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                        except Exception:
                            pass
    except Exception:
        pass


def get_db():
    """FastAPI 의존성: 요청 단위 DB 세션."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
