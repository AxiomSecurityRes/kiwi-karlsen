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


# CSV 가 없을 때 사용할 내장 샘플 (모두 검증된 1수 외통 퍼즐)
_FALLBACK = [
    {
        "PuzzleId": "kiwi0001",
        "FEN": "7k/5ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1",
        "Moves": "h8g8 e1e8",
        "Rating": "750", "RatingDeviation": "80", "Popularity": "95",
        "NbPlays": "100", "Themes": "mateIn1 backRankMate", "GameUrl": "", "OpeningTags": "",
    },
    {
        "PuzzleId": "kiwi0002",
        "FEN": "7k/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 1",
        "Moves": "h8g8 d1d8",
        "Rating": "800", "RatingDeviation": "80", "Popularity": "94",
        "NbPlays": "100", "Themes": "mateIn1 backRankMate", "GameUrl": "", "OpeningTags": "",
    },
    {
        "PuzzleId": "kiwi0003",
        "FEN": "6k1/5ppp/8/8/8/8/5PPP/2R3K1 b - - 0 1",
        "Moves": "g8h8 c1c8",
        "Rating": "820", "RatingDeviation": "80", "Popularity": "93",
        "NbPlays": "100", "Themes": "mateIn1 backRankMate", "GameUrl": "", "OpeningTags": "",
    },
    {
        "PuzzleId": "kiwi0004",
        "FEN": "6k1/5ppp/8/8/8/8/5PPP/Q5K1 b - - 0 1",
        "Moves": "g8h8 a1a8",
        "Rating": "700", "RatingDeviation": "80", "Popularity": "92",
        "NbPlays": "100", "Themes": "mateIn1 backRankMate", "GameUrl": "", "OpeningTags": "",
    },
    {
        "PuzzleId": "kiwi0005",
        "FEN": "7k/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1",
        "Moves": "h8g8 a1a8",
        "Rating": "730", "RatingDeviation": "80", "Popularity": "91",
        "NbPlays": "100", "Themes": "mateIn1 backRankMate", "GameUrl": "", "OpeningTags": "",
    },
]


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
    global _PUZZLES, _BY_ID
    _PUZZLES = []
    _BY_ID = {}

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

    if not rows:
        rows = _FALLBACK

    for raw in rows:
        norm = _normalize(raw)
        if norm:
            _PUZZLES.append(norm)
            _BY_ID[norm["id"]] = norm


def count() -> int:
    return len(_PUZZLES)


def random_puzzle(min_rating: int = 0, max_rating: int = 4000) -> Optional[dict]:
    pool = [p for p in _PUZZLES if min_rating <= p["rating"] <= max_rating]
    if not pool:
        pool = _PUZZLES
    if not pool:
        return None
    return random.choice(pool)


def get_puzzle(puzzle_id: str) -> Optional[dict]:
    return _BY_ID.get(puzzle_id)
