"""시각(Vision) 훈련 — 30초 스피드런.

두 가지 모드
  coords : 좌표 인식. "e4" 가 뜨면 그 칸을 클릭. 보드에 좌표 표시가 없다.
  moves  : 수순 인식. 국면과 "Nf3" 같은 수가 뜨면 그 수의 '도착 칸'을 클릭.

체스 좌표 감각은 기보를 읽고 계산하는 데 필수적인 기초 능력이다.
"""
from __future__ import annotations

import random

import chess
from sqlalchemy.orm import Session

from .models import User, VisionScore

MODES = {
    "coords": {"label": "좌표", "seconds": 30,
               "desc": "표시된 좌표(예: e4)의 칸을 클릭하세요."},
    "moves": {"label": "수순", "seconds": 30,
              "desc": "표시된 수(예: Nf3)가 도착하는 칸을 클릭하세요."},
}

FILES = "abcdefgh"
RANKS = "12345678"


def coord_questions(count: int = 80) -> list[dict]:
    """좌표 문제. 정답은 칸 이름 그대로."""
    out = []
    for _ in range(count):
        sq = random.choice(FILES) + random.choice(RANKS)
        out.append({"prompt": sq, "answer": sq, "fen": None})
    return out


# 수순 문제용 국면들 — 실전에서 나올 법한 오프닝~미들게임 국면
_MOVE_FENS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 3",
    "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2",
    "r1bqkb1r/pp1ppppp/2n2n2/2p5/2P5/2N2N2/PP1PPPPP/R1BQKB1R w KQkq - 0 4",
    "rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R w KQkq - 0 6",
    "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5",
    "r2q1rk1/ppp2ppp/2np1n2/2b1p3/2B1P1b1/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 8",
    "8/8/4k3/8/8/3K4/8/7R w - - 0 1",
    "r3k2r/pp3ppp/2n1bn2/2bpp3/4P3/2NP1N2/PPP1BPPP/R1B2RK1 w kq - 0 9",
]


def move_questions(count: int = 60) -> list[dict]:
    """수순 문제. 국면 + SAN 을 주고 '도착 칸'을 맞힌다."""
    out = []
    tries = 0
    while len(out) < count and tries < count * 20:
        tries += 1
        fen = random.choice(_MOVE_FENS)
        board = chess.Board(fen)
        legal = list(board.legal_moves)
        if not legal:
            continue
        mv = random.choice(legal)
        san = board.san(mv)
        target = chess.square_name(mv.to_square)
        # 캐슬링은 도착 칸이 헷갈리므로 제외
        if san in ("O-O", "O-O-O"):
            continue
        out.append({"prompt": san, "answer": target, "fen": fen})
    return out


def questions(mode: str, count: int = 80) -> list[dict]:
    if mode == "moves":
        return move_questions(count)
    return coord_questions(count)


def record(db: Session, user: User, mode: str, score: int, misses: int) -> dict:
    if mode not in MODES:
        mode = "coords"
    score = max(0, min(int(score), 300))
    misses = max(0, min(int(misses), 300))
    total = score + misses
    accuracy = round(score / total * 100) if total else 0

    db.add(VisionScore(user_id=user.id, mode=mode, score=score,
                       misses=misses, accuracy=accuracy))

    field = "vision_best_coords" if mode == "coords" else "vision_best_moves"
    prev = getattr(user, field, 0) or 0
    is_best = score > prev
    if is_best:
        setattr(user, field, score)
    db.commit()
    return {"mode": mode, "score": score, "misses": misses,
            "accuracy": accuracy, "best": max(prev, score), "isBest": is_best}


def leaderboard(db: Session, mode: str = "coords", limit: int = 20) -> list[dict]:
    if mode not in MODES:
        mode = "coords"
    field = User.vision_best_coords if mode == "coords" else User.vision_best_moves
    key = "vision_best_coords" if mode == "coords" else "vision_best_moves"
    rows = db.query(User).filter(field > 0, User.banned == 0).order_by(field.desc()).limit(limit).all()
    return [{"username": u.username, "score": getattr(u, key), "rating": round(u.rating)}
            for u in rows]


def history(db: Session, user: User, limit: int = 20) -> list[dict]:
    rows = db.query(VisionScore).filter(
        VisionScore.user_id == user.id
    ).order_by(VisionScore.id.desc()).limit(limit).all()
    return [r.to_dict() for r in rows]
