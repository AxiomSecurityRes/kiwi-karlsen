"""백엔드 체스 엔진 래퍼.

1순위: 환경변수 STOCKFISH_PATH 의 Stockfish(C++) 바이너리를 python-chess 로 구동.
2순위(폴백): Stockfish 가 없으면 순수 파이썬 알파-베타 엔진(난이도 반영).

프런트엔드는 보통 브라우저 WASM 엔진을 쓰지만, WASM 로드 실패 시
이 모듈의 /api/bot/move 로 폴백한다. 이 폴백 엔진은 항상 동작한다.
"""
import os
import random

import chess

from .bots import get_bot
from .config import settings

try:
    import chess.engine  # noqa: F401
    _ENGINE_MODULE = True
except Exception:
    _ENGINE_MODULE = False


PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000,
}

# 간단한 피스-스퀘어 테이블(백 기준, 흑은 상하 반전). 위치 감각을 부여한다.
PAWN_PST = [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
]
KNIGHT_PST = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
]
BISHOP_PST = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
]
ROOK_PST = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
]
QUEEN_PST = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
]
KING_PST = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
]
PST = {
    chess.PAWN: PAWN_PST,
    chess.KNIGHT: KNIGHT_PST,
    chess.BISHOP: BISHOP_PST,
    chess.ROOK: ROOK_PST,
    chess.QUEEN: QUEEN_PST,
    chess.KING: KING_PST,
}


def _stockfish_available() -> bool:
    return _ENGINE_MODULE and bool(settings.STOCKFISH_PATH) and os.path.exists(settings.STOCKFISH_PATH)


def _evaluate(board: chess.Board) -> int:
    """백 관점 정적 평가(센티폰). 물량 + 위치."""
    if board.is_checkmate():
        # 둘 차례인 쪽이 졌다
        return -100000 if board.turn == chess.WHITE else 100000
    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    score = 0
    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None:
            continue
        val = PIECE_VALUES[piece.piece_type]
        pst = PST[piece.piece_type]
        if piece.color == chess.WHITE:
            score += val + pst[square ^ 56]  # 백은 a1=0 기준으로 테이블 정렬
        else:
            score -= val + pst[square]
    return score


def _negamax(board: chess.Board, depth: int, alpha: int, beta: int, color: int) -> int:
    """알파-베타 네가맥스. color: 백=+1, 흑=-1."""
    if depth == 0 or board.is_game_over():
        return color * _evaluate(board)

    best = -10**9
    # 캡처 우선 정렬로 가지치기 효율↑
    moves = sorted(board.legal_moves, key=lambda m: board.is_capture(m), reverse=True)
    for move in moves:
        board.push(move)
        val = -_negamax(board, depth - 1, -beta, -alpha, -color)
        board.pop()
        if val > best:
            best = val
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    return best


def _search_move(board: chess.Board, level: int) -> chess.Move:
    """폴백 엔진: 난이도별 깊이의 알파-베타 + 무작위성."""
    cfg = get_bot(level)
    legal = list(board.legal_moves)
    if not legal:
        raise ValueError("No legal moves")

    # 1) 즉시 외통 우선
    for move in legal:
        board.push(move)
        mate = board.is_checkmate()
        board.pop()
        if mate:
            return move

    # 2) 난이도별 무작위성(약한 봇은 종종 실수)
    if random.random() < cfg["randomness"]:
        return random.choice(legal)

    # 3) 깊이 설정: 레벨에 비례(1~3수). 응답성을 위해 상한을 둔다.
    search_depth = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3, 8: 3}.get(level, 2)

    color = 1 if board.turn == chess.WHITE else -1
    best_move = legal[0]
    best_val = -10**9
    alpha, beta = -10**9, 10**9

    moves = sorted(legal, key=lambda m: board.is_capture(m), reverse=True)
    for move in moves:
        board.push(move)
        val = -_negamax(board, search_depth - 1, -beta, -alpha, -color)
        board.pop()
        # 동일 평가 시 다양성
        val += random.randint(-3, 3)
        if val > best_val:
            best_val = val
            best_move = move
        if best_val > alpha:
            alpha = best_val
    return best_move



# ---------- ELO 강도 모델 (프런트엔드와 동일 공식) ----------
import math as _math


def elo_params(elo: int) -> dict:
    elo = max(100, min(3200, int(elo or 1200)))
    return {
        "elo": elo,
        "sf_depth": max(6, min(18, 6 + elo // 250)),
        "sf_movetime": max(100, min(900, 80 + elo // 4)),
        "p_err": max(0.02, min(0.93, 1.15 - elo / 2400)),
        "max_loss": 30 + round(1000 * _math.exp(-elo / 700)),
    }


def _rank_moves(board: chess.Board, depth: int) -> list[tuple[chess.Move, int]]:
    """모든 합법수를 얕은 탐색으로 랭킹 (mover 관점, 내림차순)."""
    color = 1 if board.turn == chess.WHITE else -1
    ranked = []
    for move in board.legal_moves:
        board.push(move)
        if board.is_checkmate():
            val = 100000
        else:
            val = -_negamax(board, depth, -10**9, 10**9, -color)
        board.pop()
        ranked.append((move, val))
    ranked.sort(key=lambda x: x[1], reverse=True)
    return ranked


def _pick_error_move(board: chess.Board, max_loss: int):
    ranked = _rank_moves(board, 1)
    if len(ranked) < 2:
        return None
    best_score = ranked[0][1]
    cands = [(m, best_score - v) for m, v in ranked if 0 < best_score - v <= max_loss]
    if not cands:
        return None
    T = max(20.0, max_loss / 2.0)
    weights = [_math.exp(-loss / T) for _, loss in cands]
    total = sum(weights)
    x = random.random() * total
    for (m, _), w in zip(cands, weights):
        x -= w
        if x <= 0:
            return m
    return cands[-1][0]


def best_move_OLD_UNUSED(fen: str, level: int) -> str:
    """주어진 FEN 에서 봇의 최선수를 UCI 문자열로 반환. 항상 성공한다."""
    board = chess.Board(fen)
    if board.is_game_over():
        raise ValueError("Game already over")

    cfg = get_bot(level)

    if _stockfish_available():
        try:
            with chess.engine.SimpleEngine.popen_uci(settings.STOCKFISH_PATH) as eng:
                options = {}
                if cfg["elo"] is not None:
                    options["UCI_LimitStrength"] = True
                    options["UCI_Elo"] = cfg["elo"]
                else:
                    options["UCI_LimitStrength"] = False
                    options["Skill Level"] = cfg["skill"]
                try:
                    eng.configure(options)
                except Exception:
                    pass

                if cfg["randomness"] > 0 and random.random() < cfg["randomness"]:
                    return random.choice(list(board.legal_moves)).uci()

                limit = chess.engine.Limit(
                    depth=cfg["depth"],
                    time=max(0.05, cfg["movetime"] / 1000.0),
                )
                result = eng.play(board, limit)
                if result.move is not None:
                    return result.move.uci()
        except Exception:
            pass  # 어떤 이유로든 실패하면 내장 엔진으로 폴백

    # 내장 알파-베타 엔진 (Stockfish 미설치 시에도 항상 동작)
    return _search_move(board, level).uci()


def best_move(fen: str, level=None, elo=None) -> str:
    """봇 최선수. elo 지정 시 ELO 강도 모델, 아니면 level 봇의 approx_rating 사용."""
    board = chess.Board(fen)
    if board.is_game_over():
        raise ValueError("Game already over")

    if elo is None:
        cfg_bot = get_bot(level or 4)
        elo = cfg_bot.get("approx_rating", 1200)
    p = elo_params(elo)

    # 1) 풀 스트렝스 최선수
    best = None
    if _stockfish_available():
        try:
            with chess.engine.SimpleEngine.popen_uci(settings.STOCKFISH_PATH) as eng:
                try:
                    eng.configure({"UCI_LimitStrength": False, "Skill Level": 20})
                except Exception:
                    pass
                limit = chess.engine.Limit(depth=p["sf_depth"], time=p["sf_movetime"] / 1000.0)
                result = eng.play(board, limit)
                if result.move is not None:
                    best = result.move
        except Exception:
            best = None
    if best is None:
        depth = 3 if elo >= 900 else 2
        best = _search_move_fullstrength(board, depth)

    # 2) 실수 모델
    if random.random() < p["p_err"]:
        err = _pick_error_move(board, p["max_loss"])
        if err is not None:
            return err.uci()
    return best.uci()


def _search_move_fullstrength(board: chess.Board, depth: int) -> chess.Move:
    ranked = _rank_moves(board, max(1, depth - 1))
    if not ranked:
        raise ValueError("No legal moves")
    return ranked[0][0]
