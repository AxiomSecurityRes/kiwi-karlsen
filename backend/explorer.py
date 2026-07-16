"""오프닝 탐색기 — 수순별 게임 수 · 승률 통계.

두 개의 소스를 지원한다.
  1) lichess : Lichess Opening Explorer (수백만 판). 레이팅 범위·시간제어 필터 지원.
               서버에서 프록시하므로 브라우저 CSP 와 무관하다.
  2) local   : 우리 사이트에서 실제로 둔 게임들로 만든 통계. 항상 동작한다.

Lichess 응답은 DB(explorer_cache)에 캐싱해 재요청과 레이트리밋을 피한다.
네트워크가 막히면 자동으로 local 로 폴백한다.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from typing import Optional

import chess

from .models import ExplorerCache, Game

LICHESS_URL = "https://explorer.lichess.ovh/lichess"

# 선택 가능한 레이팅 구간 (Lichess 탐색기 규격)
RATING_BANDS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]
SPEEDS = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"]

DEFAULT_RATINGS = [1600, 1800, 2000, 2200, 2500]
DEFAULT_SPEEDS = ["blitz", "rapid", "classical"]

CACHE_TTL_HOURS = 72
_HTTP_TIMEOUT = 6.0

# 최근 실패 시각 — 연속 실패하면 잠시 온라인 조회를 쉰다(응답 지연 방지)
_last_failure = 0.0
_FAILURE_COOLDOWN = 120.0


def _cache_key(fen: str, ratings: list[int], speeds: list[str]) -> str:
    r = ",".join(str(x) for x in sorted(ratings))
    s = ",".join(sorted(speeds))
    return f"{fen}|{r}|{s}"


def _from_cache(db, key: str) -> Optional[dict]:
    try:
        row = db.query(ExplorerCache).filter(ExplorerCache.key == key).first()
    except Exception:
        return None
    if not row:
        return None
    if row.updated_at and row.updated_at < datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS):
        return None
    try:
        return json.loads(row.payload)
    except Exception:
        return None


def _to_cache(db, key: str, payload: dict) -> None:
    try:
        row = db.query(ExplorerCache).filter(ExplorerCache.key == key).first()
        if row:
            row.payload = json.dumps(payload, ensure_ascii=False)
            row.updated_at = datetime.utcnow()
        else:
            db.add(ExplorerCache(key=key[:400], payload=json.dumps(payload, ensure_ascii=False)))
        db.commit()
    except Exception:
        db.rollback()


def _fetch_lichess(fen: str, ratings: list[int], speeds: list[str]) -> Optional[dict]:
    """Lichess 탐색기 조회. 실패하면 None."""
    global _last_failure
    if time.time() - _last_failure < _FAILURE_COOLDOWN:
        return None
    try:
        import httpx
    except Exception:
        return None

    params = [("variant", "standard"), ("fen", fen), ("moves", "12"), ("topGames", "0"),
              ("recentGames", "0")]
    for r in ratings:
        params.append(("ratings", str(r)))
    for s in speeds:
        params.append(("speeds", s))

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT, follow_redirects=True) as client:
            res = client.get(LICHESS_URL, params=params,
                             headers={"User-Agent": "KiwiKarlsen/1.0"})
            if res.status_code != 200:
                _last_failure = time.time()
                return None
            return res.json()
    except Exception:
        _last_failure = time.time()
        return None


def _normalize_lichess(data: dict) -> dict:
    white = int(data.get("white") or 0)
    draws = int(data.get("draws") or 0)
    black = int(data.get("black") or 0)
    total = white + draws + black

    moves = []
    for m in (data.get("moves") or []):
        w = int(m.get("white") or 0)
        d = int(m.get("draws") or 0)
        b = int(m.get("black") or 0)
        t = w + d + b
        if t <= 0:
            continue
        moves.append({
            "san": m.get("san") or "",
            "uci": m.get("uci") or "",
            "games": t,
            "white": w, "draws": d, "black": b,
            "whitePct": round(w / t * 100, 1),
            "drawPct": round(d / t * 100, 1),
            "blackPct": round(b / t * 100, 1),
            "share": 0.0,   # 아래에서 채움
            "avgRating": m.get("averageRating"),
        })
    move_total = sum(m["games"] for m in moves) or 1
    for m in moves:
        m["share"] = round(m["games"] / move_total * 100, 1)
    moves.sort(key=lambda x: x["games"], reverse=True)

    return {
        "source": "lichess",
        "total": total,
        "white": white, "draws": draws, "black": black,
        "whitePct": round(white / total * 100, 1) if total else 0.0,
        "drawPct": round(draws / total * 100, 1) if total else 0.0,
        "blackPct": round(black / total * 100, 1) if total else 0.0,
        "moves": moves,
    }


# ---------------------------------------------------------------------------
# 로컬 통계 — 우리 사이트에서 둔 게임들로 만든다
# ---------------------------------------------------------------------------
_local_index: dict[str, dict] = {}   # 국면키 -> {san: {white, draws, black}}
_local_totals: dict[str, dict] = {}  # 국면키 -> {white, draws, black}
_local_built_at: float = 0.0
_LOCAL_TTL = 300.0                   # 5분마다 갱신
_MAX_PLIES = 24                      # 오프닝 구간만 집계


def _pos_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def build_local(db) -> int:
    """우리 게임 DB(PGN)를 파싱해 국면별 통계를 만든다."""
    global _local_index, _local_totals, _local_built_at
    index: dict[str, dict] = {}
    totals: dict[str, dict] = {}
    count = 0

    try:
        rows = db.query(Game).order_by(Game.id.desc()).limit(3000).all()
    except Exception:
        rows = []

    for g in rows:
        pgn = (g.pgn or "").strip()
        if not pgn:
            continue
        result = g.result
        if result not in ("1-0", "0-1", "1/2-1/2"):
            continue
        # SAN 토큰만 추출 (수 번호 제거)
        sans = [t for t in pgn.replace("\n", " ").split()
                if t and not t[0].isdigit() and t not in ("1-0", "0-1", "1/2-1/2", "*")]
        board = chess.Board()
        ok = False
        for i, san in enumerate(sans[:_MAX_PLIES]):
            key = _pos_key(board)
            try:
                board.push_san(san)
            except Exception:
                break
            ok = True
            node = index.setdefault(key, {})
            cell = node.setdefault(san, {"white": 0, "draws": 0, "black": 0})
            tot = totals.setdefault(key, {"white": 0, "draws": 0, "black": 0})
            if result == "1-0":
                cell["white"] += 1
                tot["white"] += 1
            elif result == "0-1":
                cell["black"] += 1
                tot["black"] += 1
            else:
                cell["draws"] += 1
                tot["draws"] += 1
        if ok:
            count += 1

    _local_index = index
    _local_totals = totals
    _local_built_at = time.time()
    return count


def _local_stats(db, board: chess.Board) -> dict:
    if time.time() - _local_built_at > _LOCAL_TTL:
        build_local(db)

    key = _pos_key(board)
    node = _local_index.get(key, {})
    tot = _local_totals.get(key, {"white": 0, "draws": 0, "black": 0})
    total = tot["white"] + tot["draws"] + tot["black"]

    moves = []
    for san, c in node.items():
        t = c["white"] + c["draws"] + c["black"]
        if t <= 0:
            continue
        moves.append({
            "san": san, "uci": "",
            "games": t,
            "white": c["white"], "draws": c["draws"], "black": c["black"],
            "whitePct": round(c["white"] / t * 100, 1),
            "drawPct": round(c["draws"] / t * 100, 1),
            "blackPct": round(c["black"] / t * 100, 1),
            "share": round(t / total * 100, 1) if total else 0.0,
            "avgRating": None,
        })
    moves.sort(key=lambda x: x["games"], reverse=True)

    return {
        "source": "local",
        "total": total,
        "white": tot["white"], "draws": tot["draws"], "black": tot["black"],
        "whitePct": round(tot["white"] / total * 100, 1) if total else 0.0,
        "drawPct": round(tot["draws"] / total * 100, 1) if total else 0.0,
        "blackPct": round(tot["black"] / total * 100, 1) if total else 0.0,
        "moves": moves,
    }


# ---------------------------------------------------------------------------
# 통합 조회
# ---------------------------------------------------------------------------
def explore(db, moves: list[str], ratings: list[int] | None = None,
            speeds: list[str] | None = None, source: str = "lichess") -> dict:
    ratings = [r for r in (ratings or DEFAULT_RATINGS) if r in RATING_BANDS] or DEFAULT_RATINGS
    speeds = [s for s in (speeds or DEFAULT_SPEEDS) if s in SPEEDS] or DEFAULT_SPEEDS

    board = chess.Board()
    for san in moves:
        try:
            board.push_san(san)
        except Exception:
            break
    fen = board.fen()

    if source == "local":
        out = _local_stats(db, board)
        out["fen"] = fen
        out["fallback"] = False
        return out

    key = _cache_key(fen, ratings, speeds)
    cached = _from_cache(db, key)
    if cached:
        cached["fen"] = fen
        cached["cached"] = True
        cached["fallback"] = False
        return cached

    raw = _fetch_lichess(fen, ratings, speeds)
    if raw is None:
        out = _local_stats(db, board)
        out["fen"] = fen
        out["fallback"] = True   # 온라인 조회 실패 → 로컬 통계로 대체
        return out

    out = _normalize_lichess(raw)
    _to_cache(db, key, out)
    out["fen"] = fen
    out["cached"] = False
    out["fallback"] = False
    return out
