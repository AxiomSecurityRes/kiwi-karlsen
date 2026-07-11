"""Lichess 형식 퍼즐 로더/서버.

CSV 헤더: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
- FEN: 퍼즐 시작 직전 국면
- Moves[0]: 자동 재생되는 상대 수 (이걸 둔 뒤 풀이자가 둘 차례가 됨)
- Moves[1..]: 정답 수열 (풀이자/상대 번갈아)
"""
import csv
import os
import random
from typing import Optional

from .config import settings

_PUZZLES: list[dict] = []
_BY_ID: dict[str, dict] = {}
_THEME_COUNTS: dict[str, int] = {}

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
    rows: list[dict] = []
    if path and os.path.exists(path):
        try:
            with open(path, newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for raw in reader:
                    rows.append(raw)
        except Exception:
            rows = []


    for raw in rows:
        norm = _normalize(raw)
        if norm:
            # 테마를 리스트로 분해해 인덱스 구축
            norm["theme_list"] = norm["themes"].split() if norm["themes"] else []
            _PUZZLES.append(norm)
            _BY_ID[norm["id"]] = norm
            for th in norm["theme_list"]:
                _THEME_COUNTS[th] = _THEME_COUNTS.get(th, 0) + 1


def count() -> int:
    return len(_PUZZLES)


def themes() -> list[dict]:
    """사용 가능한 테마 목록(개수 많은 순). 표시명 포함."""
    items = sorted(_THEME_COUNTS.items(), key=lambda kv: kv[1], reverse=True)
    out = []
    for code, n in items:
        out.append({"code": code, "label": THEME_LABELS.get(code, code), "count": n})
    return out


def random_puzzle(min_rating: int = 0, max_rating: int = 4000,
                  theme: str = "") -> Optional[dict]:
    def ok(p):
        if not (min_rating <= p["rating"] <= max_rating):
            return False
        if theme and theme not in p.get("theme_list", []):
            return False
        return True

    pool = [p for p in _PUZZLES if ok(p)]
    if not pool:
        # 조건을 만족하는 퍼즐이 없으면 레이팅만 맞춰 폴백
        pool = [p for p in _PUZZLES if min_rating <= p["rating"] <= max_rating] or _PUZZLES
    if not pool:
        return None
    return random.choice(pool)


def get_puzzle(puzzle_id: str) -> Optional[dict]:
    return _BY_ID.get(puzzle_id)
