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

    # 전투 / 시각 훈련
    battle_wins = Column(Integer, default=0, nullable=False)
    battle_losses = Column(Integer, default=0, nullable=False)
    vision_best_coords = Column(Integer, default=0, nullable=False)
    vision_best_moves = Column(Integer, default=0, nullable=False)

    # 보안
    token_version = Column(Integer, default=1, nullable=False)   # 토큰 폐기용
    totp_secret = Column(String(64), default="", nullable=False) # 2FA 시크릿
    totp_enabled = Column(Integer, default=0, nullable=False)
    backup_codes = Column(Text, default="", nullable=False)      # 해시된 1회용 코드
    terms_accepted_at = Column(DateTime, nullable=True)          # 약관 동의 시각
    last_login_at = Column(DateTime, nullable=True)
    password_changed_at = Column(DateTime, nullable=True)

    # Chess.com 게임 가져오기 연동
    chesscom_username = Column(String(40), default="", nullable=False)
    chesscom_synced_at = Column(DateTime, nullable=True)

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
            "battleWins": self.battle_wins,
            "battleLosses": self.battle_losses,
            "visionBestCoords": self.vision_best_coords,
            "visionBestMoves": self.vision_best_moves,
            "isAdmin": bool(self.is_admin),
            "twoFactor": bool(self.totp_enabled),
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

    # 통찰(Insights) 용 부가 정보
    minutes = Column(Integer, default=0, nullable=False)       # 시간 제어(분)
    increment = Column(Integer, default=0, nullable=False)     # 증가(초)
    ply_count = Column(Integer, default=0, nullable=False)     # 총 플라이 수
    white_rating_after = Column(Float, default=0.0)            # 대국 후 레이팅
    black_rating_after = Column(Float, default=0.0)
    # 게임 출처 — 'site'(우리 대국) / 'chesscom'(가져온 게임)
    source = Column(String(12), default="site", nullable=False, index=True)
    ext_id = Column(String(80), default="", nullable=False)    # 외부 게임 식별자(중복 방지)
    opp_country = Column(String(8), default="", nullable=False)  # 상대 국가코드(지리 통계)

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


class ExplorerCache(Base):
    """오프닝 탐색기 응답 캐시 (Lichess 조회 결과)."""
    __tablename__ = "explorer_cache"

    key = Column(String(400), primary_key=True)
    payload = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow,
                        nullable=False, index=True)


class OpeningProgress(Base):
    """오프닝 배우기 진도."""
    __tablename__ = "opening_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    opening_key = Column(String(160), nullable=False, index=True)   # eco|name
    attempts = Column(Integer, default=0, nullable=False)
    best_score = Column(Integer, default=0, nullable=False)          # 정답률 0~100
    mastered = Column(Integer, default=0, nullable=False)            # 90점 이상 1회 → 1
    last_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "openingKey": self.opening_key,
            "attempts": self.attempts,
            "bestScore": self.best_score,
            "mastered": bool(self.mastered),
            "lastAt": self.last_at.isoformat() if self.last_at else "",
        }


class BattleSession(Base):
    """퍼즐 전투 기록 (실시간 1:1 퍼즐 대결)."""
    __tablename__ = "battle_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    opponent_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    opponent_name = Column(String(40), default="", nullable=False)
    score = Column(Integer, default=0, nullable=False)
    opponent_score = Column(Integer, default=0, nullable=False)
    result = Column(String(8), default="draw", nullable=False)   # win / loss / draw
    seconds = Column(Integer, default=180, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "opponent": self.opponent_name,
            "score": self.score,
            "opponentScore": self.opponent_score,
            "result": self.result,
            "seconds": self.seconds,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class VisionScore(Base):
    """시각(Vision) 훈련 기록 — 30초 좌표/수순 스피드런."""
    __tablename__ = "vision_scores"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    mode = Column(String(12), nullable=False, index=True)   # coords / moves
    score = Column(Integer, default=0, nullable=False)
    misses = Column(Integer, default=0, nullable=False)
    accuracy = Column(Integer, default=0, nullable=False)   # 0~100
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "mode": self.mode, "score": self.score,
            "misses": self.misses, "accuracy": self.accuracy,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class Club(Base):
    """체스 클럽."""
    __tablename__ = "clubs"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(40), unique=True, nullable=False, index=True)
    name = Column(String(60), nullable=False)
    description = Column(Text, default="", nullable=False)
    emoji = Column(String(8), default="🏰", nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    is_public = Column(Integer, default=1, nullable=False)   # 1=공개(자유 가입)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def to_dict(self, members: int = 0) -> dict:
        return {
            "id": self.id,
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "emoji": self.emoji,
            "ownerId": self.owner_id,
            "isPublic": bool(self.is_public),
            "members": members,
            "createdAt": self.created_at.isoformat() if self.created_at else "",
        }


class ClubMember(Base):
    """클럽 구성원."""
    __tablename__ = "club_members"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String(10), default="member", nullable=False)   # owner / admin / member
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class ClubPost(Base):
    """클럽 공지물 / 게시글. 국면(FEN)이나 기보(PGN)를 붙일 수 있다."""
    __tablename__ = "club_posts"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    author_name = Column(String(40), default="", nullable=False)
    title = Column(String(120), nullable=False)
    body = Column(Text, default="", nullable=False)
    fen = Column(String(100), default="", nullable=False)   # 클럽 보드로 띄울 국면
    pgn = Column(Text, default="", nullable=False)          # 또는 기보
    pinned = Column(Integer, default=0, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "authorName": self.author_name,
            "authorId": self.user_id,
            "title": self.title,
            "body": self.body,
            "fen": self.fen,
            "pgn": self.pgn,
            "pinned": bool(self.pinned),
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class ClubMessage(Base):
    """클럽 채팅."""
    __tablename__ = "club_messages"

    id = Column(Integer, primary_key=True, index=True)
    club_id = Column(Integer, ForeignKey("clubs.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    author_name = Column(String(40), default="", nullable=False)
    text = Column(String(600), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "authorId": self.user_id,
            "authorName": self.author_name,
            "text": self.text,
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class GameReview(Base):
    """게임 리뷰 결과 — 정확도/분류 통계. 통찰(Insights)에 쓰인다."""
    __tablename__ = "game_reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=True, index=True)
    color = Column(String(5), default="white", nullable=False)
    accuracy = Column(Float, default=0.0, nullable=False)
    est_elo = Column(Integer, default=0, nullable=False)
    avg_loss = Column(Float, default=0.0, nullable=False)   # 평균 승률 손실(%)

    # 전술 포착
    tactics_total = Column(Integer, default=0, nullable=False)
    tactics_found = Column(Integer, default=0, nullable=False)
    opponent_accuracy = Column(Float, default=0.0, nullable=False)
    # 게임 결과·단계 (통찰 연계용)
    result = Column(String(6), default="", nullable=False)      # win/loss/draw
    end_phase = Column(String(12), default="", nullable=False)  # 종료된 단계
    game_shape = Column(String(16), default="", nullable=False)  # 게임 양상

    brilliant = Column(Integer, default=0, nullable=False)
    great = Column(Integer, default=0, nullable=False)
    best = Column(Integer, default=0, nullable=False)
    excellent = Column(Integer, default=0, nullable=False)
    good = Column(Integer, default=0, nullable=False)
    book = Column(Integer, default=0, nullable=False)
    forced = Column(Integer, default=0, nullable=False)
    inaccuracy = Column(Integer, default=0, nullable=False)
    mistake = Column(Integer, default=0, nullable=False)
    missed = Column(Integer, default=0, nullable=False)
    blunder = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id, "gameId": self.game_id, "color": self.color,
            "accuracy": round(self.accuracy, 1), "estElo": self.est_elo,
            "avgLoss": round(self.avg_loss, 1),
            "counts": {
                "brilliant": self.brilliant, "great": self.great, "best": self.best,
                "excellent": self.excellent, "good": self.good, "book": self.book,
                "forced": self.forced, "inaccuracy": self.inaccuracy,
                "mistake": self.mistake, "missed": self.missed, "blunder": self.blunder,
            },
            "ts": self.created_at.isoformat() if self.created_at else "",
        }


class ReviewMove(Base):
    """게임 리뷰의 '수별' 상세 데이터 — 통찰의 원천.

    수 번호별 정확도, 기물별 정확도, 캐슬링, 게임 단계, 전술 포착 등
    모든 세부 통계가 이 테이블에서 나온다.
    """
    __tablename__ = "review_moves"

    id = Column(Integer, primary_key=True, index=True)
    review_id = Column(Integer, ForeignKey("game_reviews.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    ply = Column(Integer, nullable=False)            # 1부터
    move_no = Column(Integer, nullable=False)        # 수 번호 (1., 2., …)
    color = Column(String(5), nullable=False)
    san = Column(String(12), default="", nullable=False)
    piece = Column(String(1), default="", nullable=False)   # p n b r q k
    from_sq = Column(String(2), default="", nullable=False)
    to_sq = Column(String(2), default="", nullable=False)

    classification = Column(String(12), nullable=False, index=True)
    accuracy = Column(Float, default=0.0, nullable=False)
    loss = Column(Float, default=0.0, nullable=False)       # 승률 손실 %
    phase = Column(String(12), default="middlegame", nullable=False, index=True)

    is_capture = Column(Integer, default=0, nullable=False)
    is_castle = Column(Integer, default=0, nullable=False)
    castle_side = Column(String(6), default="", nullable=False)   # king / queen
    is_check = Column(Integer, default=0, nullable=False)
    is_promotion = Column(Integer, default=0, nullable=False)
    is_book = Column(Integer, default=0, nullable=False)
    is_best = Column(Integer, default=0, nullable=False)
    is_tactic = Column(Integer, default=0, nullable=False)
    tactic_found = Column(Integer, default=0, nullable=False)
