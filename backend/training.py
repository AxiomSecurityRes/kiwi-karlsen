"""퍼즐 훈련 — 퍼즐 레이팅(Elo), 일일 퍼즐, 퍼즐 러시.

- 퍼즐 레이팅: 사용자 vs 퍼즐의 Elo 대결로 갱신
- 일일 퍼즐: 날짜별로 고정된 퍼즐(모두 같은 문제), 하루 한 번 기록
- 퍼즐 러시: 제한 시간 내 최대한 많이. 쉬운 것 → 어려운 것 순으로 출제.
"""
from __future__ import annotations

import hashlib
import random
from datetime import date, datetime

from sqlalchemy.orm import Session

from . import puzzles as puzzle_db
from .models import DailyPuzzle, DailySolve, RushSession, User

# ---------------------------------------------------------------------------
# 퍼즐 레이팅 (Elo)
# ---------------------------------------------------------------------------
K_FACTOR = 24
MIN_RATING = 400
MAX_RATING = 3200


def expected_score(player: float, opponent: float) -> float:
    return 1.0 / (1.0 + 10 ** ((opponent - player) / 400.0))


def update_puzzle_rating(user: User, puzzle_rating: int, success: bool) -> tuple[int, int]:
    """퍼즐 풀이 결과로 사용자 퍼즐 레이팅 갱신. (이전, 이후) 반환."""
    before = round(user.puzzle_rating)
    exp = expected_score(user.puzzle_rating, float(puzzle_rating))
    actual = 1.0 if success else 0.0
    new = user.puzzle_rating + K_FACTOR * (actual - exp)
    user.puzzle_rating = max(MIN_RATING, min(MAX_RATING, new))
    if success:
        user.puzzles_solved += 1
    else:
        user.puzzles_failed += 1
    return before, round(user.puzzle_rating)


# ---------------------------------------------------------------------------
# 일일 퍼즐
# ---------------------------------------------------------------------------
def today_str() -> str:
    return date.today().isoformat()


def get_daily(db: Session, day: str | None = None) -> dict | None:
    """오늘의 퍼즐. 없으면 날짜를 시드로 결정론적으로 하나 골라 저장."""
    day = day or today_str()
    if puzzle_db.count() == 0:
        return None

    row = db.query(DailyPuzzle).filter(DailyPuzzle.day == day).first()
    if row:
        p = puzzle_db.get_puzzle(row.puzzle_id)
        if p:
            return p
        # 저장된 퍼즐이 사라졌으면 다시 뽑는다
        db.delete(row)
        db.commit()

    # 날짜 해시로 결정론적 선택 (모든 사용자가 같은 문제)
    all_p = puzzle_db.all_puzzles()
    if not all_p:
        return None
    h = int(hashlib.sha256(day.encode()).hexdigest(), 16)
    p = all_p[h % len(all_p)]
    db.add(DailyPuzzle(day=day, puzzle_id=p["id"]))
    db.commit()
    return p


def daily_status(db: Session, user: User, day: str | None = None) -> dict:
    day = day or today_str()
    row = db.query(DailySolve).filter(
        DailySolve.user_id == user.id, DailySolve.day == day
    ).first()
    return {
        "day": day,
        "attempted": bool(row),
        "success": bool(row and row.success),
        "seconds": row.seconds if row else 0,
    }


def record_daily(db: Session, user: User, success: bool, seconds: int,
                 day: str | None = None) -> bool:
    """일일 퍼즐 결과 기록. 이미 기록했으면 False."""
    day = day or today_str()
    exists = db.query(DailySolve).filter(
        DailySolve.user_id == user.id, DailySolve.day == day
    ).first()
    if exists:
        return False
    db.add(DailySolve(user_id=user.id, day=day, success=1 if success else 0,
                      seconds=max(0, min(seconds, 86400))))
    db.commit()
    return True


# ---------------------------------------------------------------------------
# 퍼즐 러시
# ---------------------------------------------------------------------------
RUSH_MODES = {
    "3m": {"label": "3분", "seconds": 180, "max_misses": 3},
    "5m": {"label": "5분", "seconds": 300, "max_misses": 3},
    "survival": {"label": "서바이벌", "seconds": 0, "max_misses": 3},
}


def rush_puzzles(count: int = 60, start_rating: int = 500, step: int = 35) -> list[dict]:
    """러시용 퍼즐 세트. 앞은 쉽고 뒤로 갈수록 어려워진다.

    레이팅 구간별로 후보를 한 번만 잘라내고 그 안에서 표본을 뽑아,
    대용량 DB(수만 개)에서도 빠르게 만든다.
    """
    out: list[dict] = []
    used: set[str] = set()
    for i in range(count):
        target = start_rating + i * step
        pool = puzzle_db.range_pool(target - 120, target + 120)
        p = None
        if pool:
            # 구간 안에서 미사용 퍼즐을 몇 번만 시도(구간이 크므로 거의 항상 성공)
            for _ in range(4):
                cand = random.choice(pool)
                if cand["id"] not in used:
                    p = cand
                    break
        if not p:
            p = puzzle_db.random_puzzle(0, 4000)
        if not p:
            break
        used.add(p["id"])
        out.append(p)
    return out


def record_rush(db: Session, user: User, mode: str, score: int, misses: int) -> dict:
    """러시 결과 저장 + 최고 기록 갱신."""
    if mode not in RUSH_MODES:
        mode = "3m"
    score = max(0, min(score, 500))
    misses = max(0, min(misses, 100))

    db.add(RushSession(user_id=user.id, mode=mode, score=score, misses=misses))

    best_field = {"3m": "rush_best_3m", "5m": "rush_best_5m",
                  "survival": "rush_best_survival"}[mode]
    prev_best = getattr(user, best_field, 0)
    is_best = score > prev_best
    if is_best:
        setattr(user, best_field, score)
    db.commit()
    return {"score": score, "best": max(prev_best, score), "isBest": is_best, "mode": mode}


def rush_leaderboard(db: Session, mode: str = "3m", limit: int = 20) -> list[dict]:
    if mode not in RUSH_MODES:
        mode = "3m"
    field = {"3m": User.rush_best_3m, "5m": User.rush_best_5m,
             "survival": User.rush_best_survival}[mode]
    rows = db.query(User).filter(field > 0, User.banned == 0).order_by(field.desc()).limit(limit).all()
    key = {"3m": "rush_best_3m", "5m": "rush_best_5m", "survival": "rush_best_survival"}[mode]
    return [{"username": u.username, "score": getattr(u, key), "rating": round(u.rating)}
            for u in rows]


def puzzle_leaderboard(db: Session, limit: int = 20) -> list[dict]:
    rows = db.query(User).filter(
        User.puzzles_solved > 0, User.banned == 0
    ).order_by(User.puzzle_rating.desc()).limit(limit).all()
    return [{"username": u.username, "puzzleRating": round(u.puzzle_rating),
             "solved": u.puzzles_solved} for u in rows]
