"""오프닝 탐색기 — Lichess 공식 오프닝 DB(3,800여 종) 기반.

핵심: **국면(position) 기반 매칭**이라 전위(transposition)를 자동으로 인식한다.
  1.d4 d5 2.Bf4 와 1.Nf3 d5 2.d4 Nf6 3.Bf4 는 같은 국면 → 둘 다 London System.

데이터: data/openings.tsv  (eco / name / moves(SAN 공백구분))
출처: lichess-org/chess-openings (public domain)
"""
from __future__ import annotations

import csv
import os
from typing import Optional

import chess

_DATA_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "openings.tsv",
)

# (eco, name, [san...])
OPENINGS: list[tuple[str, str, list[str]]] = []

_POS_INFO: dict[str, dict] = {}       # 국면키 -> 가장 구체적인 오프닝 정보
_POS_CHILDREN: dict[str, dict] = {}   # 국면키 -> {san: {eco, name}}
_BOOK_POSITIONS: set[str] = set()     # 정석에 등장하는 모든 국면 (이론 판정용)


def _key(board: chess.Board):
    """국면키 — 배치/차례/캐슬링/앙파상만 반영(수 카운터 제외)하므로
    전위(transposition)를 자동으로 흡수한다.
    python-chess 의 내부 전치표 키를 쓴다(FEN 문자열 생성보다 40배 이상 빠름)."""
    return board._transposition_key()


# UCI 수순(사전 계산됨) — SAN 파싱보다 훨씬 빨라 startup 이 가볍다
_UCI: list[list[str]] = []


def load() -> None:
    global OPENINGS, _UCI
    OPENINGS = []
    _UCI = []
    _POS_INFO.clear()
    _POS_CHILDREN.clear()
    _BOOK_POSITIONS.clear()

    if not os.path.exists(_DATA_FILE):
        return

    try:
        with open(_DATA_FILE, encoding="utf-8") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            for row in reader:
                eco = (row.get("eco") or "").strip()
                name = (row.get("name") or "").strip()
                moves = (row.get("moves") or "").split()
                uci = (row.get("uci") or "").split()
                if name and moves and len(uci) == len(moves):
                    OPENINGS.append((eco, name, moves))
                    _UCI.append(uci)
    except Exception:
        OPENINGS = []
        _UCI = []
        return

    _build_index()


def _build_index() -> None:
    """국면 인덱스 구축.

    이름은 **각 오프닝 라인의 마지막 국면에만** 붙인다.
    (다른 오프닝의 더 긴 라인이 같은 국면을 지나가며 이름을 덮어쓰는 것을 방지.
     예: Italian Game 국면이 'Four Knights' 로 잘못 표시되던 문제)
    """
    _BOOK_POSITIONS.add(_key(chess.Board()))

    for idx, (eco, name, moves) in enumerate(OPENINGS):
        ucis = _UCI[idx]
        board = chess.Board()
        last = len(moves) - 1
        for i, u in enumerate(ucis):
            parent = _key(board)
            try:
                board.push(chess.Move.from_uci(u))
            except Exception:
                break
            child = _key(board)
            _BOOK_POSITIONS.add(child)

            kids = _POS_CHILDREN.setdefault(parent, {})
            san = moves[i]
            if san not in kids:
                kids[san] = {"eco": eco, "name": name}

            # 종단 국면에만 이름 부여
            if i == last:
                depth = i + 1
                cur = _POS_INFO.get(child)
                if not cur or depth > cur["depth"]:
                    _POS_INFO[child] = {
                        "eco": eco, "name": name,
                        "moves": list(moves), "depth": depth,
                    }


load()


def _replay(moves: list[str]) -> Optional[chess.Board]:
    board = chess.Board()
    for san in moves:
        try:
            board.push_san(san)
        except Exception:
            return None
    return board


def lookup(moves: list[str]) -> Optional[dict]:
    """현재 국면의 오프닝. 정석에서 벗어났으면 마지막으로 지나온 오프닝."""
    board = chess.Board()
    last = None
    for san in moves:
        try:
            board.push_san(san)
        except Exception:
            break
        info = _POS_INFO.get(_key(board))
        if info:
            last = info
    return last


def continuations(moves: list[str]) -> list[dict]:
    """이 국면에서 이어지는 정석 수들 (전위로 도달했어도 동작)."""
    board = _replay(moves)
    if board is None:
        return []
    kids = _POS_CHILDREN.get(_key(board), {})
    out = [{"san": san, "eco": info["eco"], "name": info["name"]}
           for san, info in kids.items()]
    out.sort(key=lambda x: x["san"])
    return out


def book_flags(moves: list[str]) -> list[bool]:
    """각 수가 '이론(정석)'인지 판정. 게임 리뷰에서 오프닝 수가
    '부정확함'으로 잘못 분류되는 것을 막는다."""
    flags: list[bool] = []
    board = chess.Board()
    in_book = True
    for san in moves:
        if not in_book:
            flags.append(False)
            continue
        try:
            board.push_san(san)
        except Exception:
            flags.append(False)
            in_book = False
            continue
        is_book = _key(board) in _BOOK_POSITIONS
        flags.append(is_book)
        if not is_book:
            in_book = False   # 한 번 벗어나면 이후는 이론이 아니다
    return flags


def count() -> int:
    return len(OPENINGS)


def position_count() -> int:
    return len(_BOOK_POSITIONS)


def search(query: str, limit: int = 50) -> list[dict]:
    q = (query or "").strip().lower()
    if not q:
        return []
    exact_eco = len(q) == 3 and q[0].isalpha() and q[1:].isdigit()
    out = []
    for eco, name, moves in OPENINGS:
        if (q in name.lower()) or (exact_eco and q == eco.lower()):
            out.append({"eco": eco, "name": name, "moves": moves})
            if len(out) >= limit:
                break
    return out
