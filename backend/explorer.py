"""오프닝 탐색기 — 수순별 게임 수 · 승률 통계.

소스:
  1) lichess : Lichess Opening Explorer (수억 판). 레이팅·시간제어 필터.
  2) masters : Lichess Masters DB (2400+ OTB 대국). 필터 없음.
  3) local   : 우리 사이트에서 둔 게임 통계. 항상 동작.

Lichess 조회는 서버에서 프록시하고 DB(explorer_cache)에 캐싱한다.
429(레이트리밋)는 흔하므로(공유 IP) 전용 쿨다운으로 처리하고,
실패 시 로컬로 폴백하되 프런트가 브라우저에서 직접 재시도할 수 있도록
사유(reason)를 함께 반환한다.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from typing import Optional

import chess

from .models import ExplorerCache, Game

LICHESS_URL = "https://explorer.lichess.ovh/lichess"
MASTERS_URL = "https://explorer.lichess.ovh/masters"

RATING_BANDS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500]
SPEEDS = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"]

DEFAULT_RATINGS = [1600, 1800, 2000, 2200, 2500]
DEFAULT_SPEEDS = ["blitz", "rapid", "classical"]

CACHE_TTL_HOURS = 72
_HTTP_TIMEOUT = 10.0

# 429 는 별도 쿨다운(1분). 그 외 오류는 짧게(20초)만 쉰다.
_last_failure = 0.0
_last_reason = ""
_FAILURE_COOLDOWN = 20.0
_RATELIMIT_COOLDOWN = 60.0
_cooldown = _FAILURE_COOLDOWN


# ---------------------------------------------------------------------------
def _uci_sequence(moves: list[str]) -> tuple[str, str]:
    """SAN 수순 → (시작국면부터의 UCI 수순 CSV, 최종 FEN)."""
    board = chess.Board()
    ucis = []
    for san in moves:
        try:
            mv = board.parse_san(san)
        except Exception:
            break
        ucis.append(mv.uci())
        board.push(mv)
    return ",".join(ucis), board.fen()


def _norm_key(fen: str) -> str:
    # 이동·전체 수 카운터를 뺀 국면 키(전위 캐시 적중률↑)
    return " ".join(fen.split()[:4])


def _cache_key(fen: str, source: str, ratings: list[int], speeds: list[str]) -> str:
    if source == "masters":
        return f"m|{_norm_key(fen)}"
    r = ",".join(str(x) for x in sorted(ratings))
    s = ",".join(sorted(speeds))
    return f"l|{_norm_key(fen)}|{r}|{s}"


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


def _fetch_lichess(play: str, source: str, ratings: list[int],
                   speeds: list[str]) -> tuple[Optional[dict], str]:
    """Lichess 탐색기 조회. 반환: (data|None, reason).

    reason: "" 성공, "cooldown"/"ratelimit"/"network"/"http" 실패 사유.
    """
    global _last_failure, _last_reason, _cooldown
    now = time.time()
    if now - _last_failure < _cooldown:
        return None, _last_reason or "cooldown"

    try:
        import httpx
    except Exception:
        return None, "network"

    if source == "masters":
        url = MASTERS_URL
        params = [("play", play), ("moves", "12"), ("topGames", "0")]
    else:
        url = LICHESS_URL
        params = [("variant", "standard"), ("play", play), ("moves", "12"),
                  ("topGames", "0"), ("recentGames", "0")]
        for r in ratings:
            params.append(("ratings", str(r)))
        for s in speeds:
            params.append(("speeds", s))

    headers = {
        "User-Agent": "KiwiKarlsen/1.0 (opening explorer; admin@kiwikarlsen.com)",
        "Accept": "application/json",
    }
    # 최대 2회 시도(네트워크 순간 오류 대비). 429 는 재시도하지 않는다.
    for attempt in range(2):
        try:
            with httpx.Client(timeout=_HTTP_TIMEOUT, follow_redirects=True) as client:
                res = client.get(url, params=params, headers=headers)
            if res.status_code == 429:
                _last_failure = time.time(); _last_reason = "ratelimit"; _cooldown = _RATELIMIT_COOLDOWN
                return None, "ratelimit"
            if res.status_code != 200:
                _last_failure = time.time(); _last_reason = "http"; _cooldown = _FAILURE_COOLDOWN
                return None, "http"
            _last_reason = ""
            return res.json(), ""
        except Exception:
            if attempt == 0:
                time.sleep(0.4)
                continue
            _last_failure = time.time(); _last_reason = "network"; _cooldown = _FAILURE_COOLDOWN
            return None, "network"
    return None, "network"


def _normalize_lichess(data: dict, source: str) -> dict:
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
            "share": 0.0,
            "avgRating": m.get("averageRating") or m.get("averageOpponentRating"),
        })
    move_total = sum(m["games"] for m in moves) or 1
    for m in moves:
        m["share"] = round(m["games"] / move_total * 100, 1)
    moves.sort(key=lambda x: x["games"], reverse=True)

    return {
        "source": source,
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
_local_index: dict[str, dict] = {}
_local_totals: dict[str, dict] = {}
_local_built_at: float = 0.0
_LOCAL_TTL = 300.0
_MAX_PLIES = 24


def _pos_key(board: chess.Board) -> str:
    return " ".join(board.fen().split()[:4])


def build_local(db) -> int:
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
        sans = [t for t in pgn.replace("\n", " ").split()
                if t and not t[0].isdigit() and t not in ("1-0", "0-1", "1/2-1/2", "*")]
        board = chess.Board()
        ok = False
        for san in sans[:_MAX_PLIES]:
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
                cell["white"] += 1; tot["white"] += 1
            elif result == "0-1":
                cell["black"] += 1; tot["black"] += 1
            else:
                cell["draws"] += 1; tot["draws"] += 1
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
def explore(db, moves: list[str], ratings: list[int] | None = None,
            speeds: list[str] | None = None, source: str = "lichess") -> dict:
    ratings = [r for r in (ratings or DEFAULT_RATINGS) if r in RATING_BANDS] or DEFAULT_RATINGS
    speeds = [s for s in (speeds or DEFAULT_SPEEDS) if s in SPEEDS] or DEFAULT_SPEEDS

    play, fen = _uci_sequence(moves)

    if source == "local":
        board = chess.Board(fen) if fen else chess.Board()
        out = _local_stats(db, board)
        out["fen"] = fen; out["play"] = play; out["fallback"] = False; out["reason"] = ""
        return out

    online = source if source in ("lichess", "masters") else "lichess"
    key = _cache_key(fen, online, ratings, speeds)
    cached = _from_cache(db, key)
    if cached:
        cached["fen"] = fen; cached["play"] = play
        cached["cached"] = True; cached["fallback"] = False; cached["reason"] = ""
        return cached

    raw, reason = _fetch_lichess(play, online, ratings, speeds)
    if raw is None:
        board = chess.Board(fen) if fen else chess.Board()
        out = _local_stats(db, board)
        out["fen"] = fen; out["play"] = play
        out["fallback"] = True          # 온라인 실패 → 로컬 대체
        out["reason"] = reason          # 프런트가 브라우저 직접 재시도 판단
        return out

    out = _normalize_lichess(raw, online)
    _to_cache(db, key, out)
    out["fen"] = fen; out["play"] = play
    out["cached"] = False; out["fallback"] = False; out["reason"] = ""
    return out
