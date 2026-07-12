import os


class Settings:
    """애플리케이션 전역 설정."""

    APP_NAME: str = "Kiwi Karlsen.com"
    VERSION: str = "v15"
    SECRET: str = os.environ.get("KIWI_SECRET", "kiwi-dev-secret-change-me")

    # SQLite 기본. 운영 시 Postgres 권장 (Render 무료 플랜은 파일시스템이 휘발성).
    DATABASE_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./kiwi_karlsen.sqlite3")

    # 백엔드 Stockfish 바이너리 경로 (없으면 내장 휴리스틱 폴백).
    STOCKFISH_PATH: str = os.environ.get("STOCKFISH_PATH", "")

    # Lichess 형식 퍼즐 CSV 경로.
    PUZZLE_FILE: str = os.environ.get("PUZZLE_FILE", "data/puzzles.csv")
    MAX_PUZZLES: int = int(os.environ.get("MAX_PUZZLES", "40000"))
    ADMIN_USERNAME: str = os.environ.get("ADMIN_USERNAME", "brady")
    ALLOWED_ORIGINS: str = os.environ.get("ALLOWED_ORIGINS", "")

    # 온라인 대국 기본 지속시간(초). 클라이언트 표시/플래그용.
    DEFAULT_CLOCK_SECONDS: int = int(os.environ.get("DEFAULT_CLOCK_SECONDS", "600"))


settings = Settings()
