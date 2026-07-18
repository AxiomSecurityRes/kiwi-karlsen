"""Chess.com 게임 가져오기.

Chess.com 공개 API(무인증)를 이용해 사용자의 월별 게임 아카이브를 받아
우리 Game 테이블에 저장한다. 저장된 게임은 통찰(Insights)에 즉시 반영되고,
분석 페이지에서 리뷰하면 정확도·수 분류 등 세부 지표까지 채워진다.

공개 API 규격:
  아카이브 목록 : https://api.chess.com/pub/player/{user}/games/archives
  월별 게임     : https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}
Chess.com 은 User-Agent 헤더를 요구한다(없으면 403).

우리 레이팅(Glicko)은 절대 건드리지 않는다 — Game 행만 삽입한다.
중복은 ext_id(게임 url)로 방지한다.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

import chess
import chess.pgn
import io

from .models import Game, User

ARCHIVES_URL = "https://api.chess.com/pub/player/{user}/games/archives"
_HEADERS = {"User-Agent": "KiwiKarlsen/1.0 (game import; contact: admin@kiwikarlsen.com)"}
_TIMEOUT = 12.0
MAX_IMPORT = 300          # 한 번에 가져올 최대 게임 수
DEFAULT_MONTHS = 3        # 최근 몇 개월치를 받을지 기본값


def _norm_username(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "", (raw or "").strip().lstrip("@"))[:40].lower()


def _client():
    import httpx
    return httpx.Client(timeout=_TIMEOUT, follow_redirects=True, headers=_HEADERS)


def verify_user(username: str) -> Optional[dict]:
    """사용자 존재 확인. 있으면 프로필 dict, 없으면 None."""
    u = _norm_username(username)
    if not u:
        return None
    try:
        with _client() as c:
            r = c.get(f"https://api.chess.com/pub/player/{u}")
            if r.status_code == 200:
                return r.json()
    except Exception:
        return None
    return None


# 상대 국가 조회 결과 캐시 (프로세스 수명 동안 유지) — 같은 상대를 반복 조회하지 않는다.
_country_cache: dict[str, str] = {}
MAX_COUNTRY_LOOKUPS = 60      # 가져오기 1회당 신규 조회 상한(API 예의)


def _country_of(client, username: str, budget: list[int]) -> str:
    """Chess.com 프로필의 country URL 에서 국가코드 추출. 실패 시 ''."""
    u = _norm_username(username)
    if not u:
        return ""
    if u in _country_cache:
        return _country_cache[u]
    if budget[0] <= 0:
        return ""
    budget[0] -= 1
    code = ""
    try:
        r = client.get(f"https://api.chess.com/pub/player/{u}")
        if r.status_code == 200:
            url = (r.json() or {}).get("country") or ""
            # 예: https://api.chess.com/pub/country/KR → "KR"
            code = url.rstrip("/").split("/")[-1][:8] if url else ""
    except Exception:
        code = ""
    _country_cache[u] = code
    return code


def _list_archives(username: str) -> list[str]:
    try:
        with _client() as c:
            r = c.get(ARCHIVES_URL.format(user=username))
            if r.status_code != 200:
                return []
            return list(r.json().get("archives") or [])
    except Exception:
        return []


# ---- Chess.com 종료 사유 → 한국어 라벨 ---------------------------------------
def _reason_ko(termination: str, result: str) -> str:
    t = (termination or "").lower()
    if "checkmate" in t:
        return "체크메이트"
    if "resign" in t:
        return "기권"
    if "time" in t and "insufficient" in t:
        return "시간패(기물부족 무)"
    if "on time" in t or "time" in t:
        return "시간패"
    if "agree" in t:
        return "합의 무승부"
    if "repetition" in t:
        return "동형반복 무"
    if "stalemate" in t:
        return "스테일메이트"
    if "insufficient" in t:
        return "기물 부족 무"
    if "50-move" in t or "50 move" in t:
        return "50수 규칙 무"
    if "abandon" in t:
        return "기권(이탈)"
    return "기타"


def _tc_minutes(time_control: str) -> tuple[int, int]:
    """'600+5' / '600' / '1/86400' → (분, 증분초). 통신/데일리는 (0,0)."""
    tc = (time_control or "").strip()
    if not tc or "/" in tc:      # daily(예: '1/86400')
        return 0, 0
    base = tc
    inc = 0
    if "+" in tc:
        base, incs = tc.split("+", 1)
        try: inc = int(incs)
        except Exception: inc = 0
    try:
        secs = int(base)
    except Exception:
        return 0, 0
    return max(0, secs // 60), inc


def _parse_dt(g: dict) -> datetime:
    # end_time(unix) 우선, 없으면 지금
    ts = g.get("end_time")
    if isinstance(ts, (int, float)) and ts > 0:
        try:
            return datetime.utcfromtimestamp(int(ts))
        except Exception:
            pass
    return datetime.utcnow()


def _headers_from_pgn(pgn: str) -> dict:
    out = {}
    for line in (pgn or "").splitlines():
        m = re.match(r'\[(\w+)\s+"(.*)"\]', line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def _ply_count(pgn: str) -> int:
    try:
        game = chess.pgn.read_game(io.StringIO(pgn))
        if not game:
            return 0
        n = 0
        node = game
        while node.variations:
            node = node.variations[0]
            n += 1
        return n
    except Exception:
        return 0


def import_games(db, user: User, username: str, months: int = DEFAULT_MONTHS,
                 max_games: int = MAX_IMPORT) -> dict:
    """Chess.com 최근 months 개월 게임을 가져와 Game 으로 저장.

    반환: {ok, imported, skipped, total, username, error}
    """
    uname = _norm_username(username)
    if not uname:
        return {"ok": False, "error": "사용자 이름이 올바르지 않습니다.", "imported": 0, "skipped": 0, "total": 0}

    prof = verify_user(uname)
    if prof is None:
        return {"ok": False, "error": f"Chess.com 에서 '{uname}' 사용자를 찾을 수 없습니다.",
                "imported": 0, "skipped": 0, "total": 0}

    archives = _list_archives(uname)
    if not archives:
        return {"ok": False, "error": "게임 아카이브를 불러오지 못했습니다. (게임이 없거나 비공개)",
                "imported": 0, "skipped": 0, "total": 0}

    months = max(1, min(24, int(months or DEFAULT_MONTHS)))
    recent = archives[-months:]

    # 이미 저장된 이 사용자의 chess.com 게임 ext_id 집합(중복 방지)
    try:
        existing = {
            e for (e,) in db.query(Game.ext_id).filter(
                (Game.white_id == user.id) | (Game.black_id == user.id),
                Game.source == "chesscom",
            ).all() if e
        }
    except Exception:
        existing = set()

    imported = 0
    skipped = 0
    total = 0
    rows = []
    budget = [MAX_COUNTRY_LOOKUPS]

    try:
        with _client() as c:
            for arch_url in reversed(recent):   # 최신 달부터
                if imported >= max_games:
                    break
                try:
                    r = c.get(arch_url)
                    if r.status_code != 200:
                        continue
                    games = r.json().get("games") or []
                except Exception:
                    continue
                # 최신 게임부터
                for g in reversed(games):
                    total += 1
                    if imported >= max_games:
                        break
                    if (g.get("rules") or "chess") != "chess":
                        continue          # 변형 체스는 제외
                    ext = g.get("url") or g.get("uuid") or ""
                    if not ext or ext in existing:
                        skipped += 1
                        continue
                    pgn = g.get("pgn") or ""
                    if not pgn:
                        skipped += 1
                        continue

                    w = (g.get("white") or {})
                    b = (g.get("black") or {})
                    w_user = _norm_username(w.get("username") or "")
                    b_user = _norm_username(b.get("username") or "")
                    me_white = (w_user == uname)
                    me_black = (b_user == uname)
                    if not (me_white or me_black):
                        skipped += 1
                        continue

                    hdr = _headers_from_pgn(pgn)
                    # 결과: chess.com per-side result 로 판정
                    w_res = (w.get("result") or "").lower()
                    if w_res == "win":
                        result = "1-0"
                    elif (b.get("result") or "").lower() == "win":
                        result = "0-1"
                    else:
                        result = "1/2-1/2"

                    reason = _reason_ko(hdr.get("Termination", ""), result)
                    minutes, inc = _tc_minutes(g.get("time_control") or hdr.get("TimeControl", ""))
                    dt = _parse_dt(g)
                    try:
                        w_elo = float(w.get("rating") or hdr.get("WhiteElo") or 0)
                        b_elo = float(b.get("rating") or hdr.get("BlackElo") or 0)
                    except Exception:
                        w_elo = b_elo = 0.0

                    rows.append(Game(
                        white_id=user.id if me_white else None,
                        black_id=user.id if me_black else None,
                        white_name=(w.get("username") or "White")[:40],
                        black_name=(b.get("username") or "Black")[:40],
                        result=result, reason=reason, pgn=pgn,
                        white_rating_change=0.0, black_rating_change=0.0,
                        minutes=minutes, increment=inc,
                        ply_count=_ply_count(pgn),
                        white_rating_after=w_elo, black_rating_after=b_elo,
                        source="chesscom", ext_id=ext[:80],
                        opp_country=_country_of(c, b_user if me_white else w_user, budget),
                        created_at=dt,
                    ))
                    existing.add(ext)
                    imported += 1
    except Exception as e:
        # 부분 성공이라도 저장
        pass

    if rows:
        try:
            db.add_all(rows)
            user.chesscom_username = uname
            user.chesscom_synced_at = datetime.utcnow()
            db.commit()
        except Exception:
            db.rollback()
            return {"ok": False, "error": "저장 중 오류가 발생했습니다.",
                    "imported": 0, "skipped": skipped, "total": total}
    else:
        # 새로 가져온 게 없어도 사용자명은 기억
        try:
            user.chesscom_username = uname
            user.chesscom_synced_at = datetime.utcnow()
            db.commit()
        except Exception:
            db.rollback()

    return {"ok": True, "imported": imported, "skipped": skipped, "total": total,
            "username": uname, "error": ""}
