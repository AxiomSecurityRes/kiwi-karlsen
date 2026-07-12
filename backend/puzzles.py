"""Lichess 형식 퍼즐 로더/서버.

CSV 헤더: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
- FEN: 퍼즐 시작 직전 국면
- Moves[0]: 자동 재생되는 상대 수 (이걸 둔 뒤 풀이자가 둘 차례가 됨)
- Moves[1..]: 정답 수열 (풀이자/상대 번갈아)
"""
import bisect
import csv
import os
import random
from typing import Optional

from .config import settings

_PUZZLES: list[dict] = []
_BY_ID: dict[str, dict] = {}
_THEME_COUNTS: dict[str, int] = {}
# 성능 인덱스: 레이팅 오름차순 정렬 + 테마별 목록 (대용량 DB에서 O(log n) 조회)
_SORTED: list[dict] = []          # 레이팅 오름차순
_SORTED_RATINGS: list[int] = []   # bisect 용 키 배열
_BY_THEME: dict[str, list[dict]] = {}

# Lichess 테마 코드 → 한글 표시명 (자주 쓰는 것 위주)
THEME_LABELS = {
    "mate": "메이트", "mateIn1": "1수 메이트", "mateIn2": "2수 메이트",
    "mateIn3": "3수 메이트", "mateIn4": "4수 메이트", "mateIn5": "5수 메이트",
    "fork": "포크", "pin": "핀", "skewer": "스큐어", "discoveredAttack": "디스커버드 어택",
    "doubleCheck": "더블 체크", "hangingPiece": "걸린 기물", "trappedPiece": "갇힌 기물",
    "sacrifice": "희생", "deflection": "유인/이탈", "decoy": "유인", "attraction": "유인",
    "clearance": "클리어런스", "interference": "차단", "intermezzo": "인터메조(중간수)",
    "zugzwang": "추크츠방", "quietMove": "조용한 수", "defensiveMove": "방어수",
    "advancedPawn": "전진 폰", "promotion": "승급", "underPromotion": "마이너 승급",
    "enPassant": "앙파상", "castling": "캐슬링",
    "backRankMate": "백랭크 메이트", "smotheredMate": "스모더드 메이트",
    "anastasiaMate": "아나스타시아 메이트", "arabianMate": "아라비안 메이트",
    "bodenMate": "보덴 메이트", "hookMate": "훅 메이트", "doubleBishopMate": "더블 비숍 메이트",
    "opening": "오프닝", "middlegame": "미들게임", "endgame": "엔드게임",
    "rookEndgame": "룩 엔드게임", "bishopEndgame": "비숍 엔드게임",
    "knightEndgame": "나이트 엔드게임", "pawnEndgame": "폰 엔드게임",
    "queenEndgame": "퀸 엔드게임", "queenRookEndgame": "퀸+룩 엔드게임",
    "crushing": "압도", "advantage": "우위", "equality": "균형",
    "short": "짧은(2수)", "long": "긴(3수+)", "veryLong": "매우 긴(4수+)",
    "oneMove": "1수", "master": "마스터 실전", "masterVsMaster": "마스터 대결",
    "superGM": "슈퍼GM", "exposedKing": "노출된 킹", "kingsideAttack": "킹사이드 공격",
    "queensideAttack": "퀸사이드 공격", "attackingF2F7": "f2/f7 공격",
}


# 내장 퍼즐 없음 — data/puzzles.csv 를 Lichess DB로 채워 사용 (scripts/download_puzzles.md)


def _normalize(row: dict) -> Optional[dict]:
    try:
        pid = row["PuzzleId"].strip()
        fen = row["FEN"].strip()
        moves = row["Moves"].strip().split()
        if not pid or not fen or len(moves) < 2:
            return None
        return {
            "id": pid,
            "fen": fen,
            "moves": moves,
            "rating": int(float(row.get("Rating", "1500") or 1500)),
            "themes": (row.get("Themes", "") or "").strip(),
            "game_url": (row.get("GameUrl", "") or "").strip(),
        }
    except Exception:
        return None


def load_puzzles() -> None:
    global _PUZZLES, _BY_ID, _THEME_COUNTS
    _PUZZLES = []
    _BY_ID = {}
    _THEME_COUNTS = {}

    path = settings.PUZZLE_FILE
    if not path or not os.path.exists(path):
        return

    # 메모리 안전: 파일 전체를 메모리에 올리지 않고 한 줄씩 스트리밍하며
    # 저수지 표본추출(reservoir sampling)로 최대 MAX_PUZZLES 개만 유지한다.
    # (Render 무료 플랜 512MB 에서 거대한 Lichess CSV 를 올려도 서버가 죽지 않도록)
    max_n = settings.MAX_PUZZLES
    scan_cap = max(max_n * 50, 2_000_000)  # 스캔 상한 (거대 파일에서 startup 지연 방지)
    reservoir: list[dict] = []
    seen = 0
    try:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for raw in reader:
                if seen >= scan_cap:
                    break
                norm = _normalize(raw)
                if not norm:
                    continue
                norm["theme_list"] = norm["themes"].split() if norm["themes"] else []
                seen += 1
                if len(reservoir) < max_n:
                    reservoir.append(norm)
                else:
                    j = random.randint(0, seen - 1)
                    if j < max_n:
                        reservoir[j] = norm
    except Exception:
        # 손상된 파일이라도 지금까지 읽은 것은 사용, 서버는 계속 뜬다
        pass

    _PUZZLES = reservoir
    for norm in _PUZZLES:
        _BY_ID[norm["id"]] = norm
        for th in norm.get("theme_list", []):
            _THEME_COUNTS[th] = _THEME_COUNTS.get(th, 0) + 1
    _build_indexes()


def _build_indexes() -> None:
    """레이팅 정렬 인덱스와 테마 인덱스를 만든다(조회를 O(log n) 으로)."""
    global _SORTED, _SORTED_RATINGS, _BY_THEME
    _SORTED = sorted(_PUZZLES, key=lambda p: p["rating"])
    _SORTED_RATINGS = [p["rating"] for p in _SORTED]
    _BY_THEME = {}
    for p in _SORTED:  # 테마별 목록도 레이팅 순 유지
        for th in p.get("theme_list", []):
            _BY_THEME.setdefault(th, []).append(p)


def count() -> int:
    return len(_PUZZLES)


def themes() -> list[dict]:
    """사용 가능한 테마 목록(개수 많은 순). 표시명 포함."""
    items = sorted(_THEME_COUNTS.items(), key=lambda kv: kv[1], reverse=True)
    out = []
    for code, n in items:
        out.append({"code": code, "label": THEME_LABELS.get(code, code), "count": n})
    return out


def _range_slice(items: list[dict], ratings: list[int],
                 min_rating: int, max_rating: int) -> list[dict]:
    """레이팅 오름차순 목록에서 [min,max] 구간을 이진 탐색으로 잘라낸다."""
    lo = bisect.bisect_left(ratings, min_rating)
    hi = bisect.bisect_right(ratings, max_rating)
    return items[lo:hi]


def random_puzzle(min_rating: int = 0, max_rating: int = 4000,
                  theme: str = "") -> Optional[dict]:
    """레이팅/테마 조건에 맞는 퍼즐 하나. 대용량에서도 빠르도록 인덱스를 쓴다."""
    if not _PUZZLES:
        return None

    if theme:
        pool_all = _BY_THEME.get(theme)
        if pool_all:
            ratings = [p["rating"] for p in pool_all]
            pool = _range_slice(pool_all, ratings, min_rating, max_rating)
            if pool:
                return random.choice(pool)
        # 테마 조건을 만족하는 게 없으면 레이팅만으로 폴백

    pool = _range_slice(_SORTED, _SORTED_RATINGS, min_rating, max_rating)
    if not pool:
        pool = _SORTED or _PUZZLES
    if not pool:
        return None
    return random.choice(pool)


def get_puzzle(puzzle_id: str) -> Optional[dict]:
    return _BY_ID.get(puzzle_id)


def all_puzzles() -> list[dict]:
    """로드된 전체 퍼즐(일일 퍼즐 결정론적 선택 등에 사용)."""
    return _PUZZLES


def range_pool(min_rating: int, max_rating: int) -> list[dict]:
    """레이팅 구간의 퍼즐 목록(읽기 전용). 이진 탐색이라 매우 빠르다."""
    if not _SORTED:
        return []
    return _range_slice(_SORTED, _SORTED_RATINGS, min_rating, max_rating)
