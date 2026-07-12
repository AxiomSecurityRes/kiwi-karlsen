"""WebSocket 매니저 + 매치메이킹 + 실시간 대국 상태 관리.

추가 기능:
- 서버 권위 클럭(시간 제한 + 시간 초과 자동 패배)
- 채팅 중계
- 무승부 제안/수락/거절
- 하트비트(ping/pong)로 유휴 연결 종료 방지
"""
import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional

import chess
from fastapi import WebSocket

from . import glicko, streak
from .config import settings
from .database import SessionLocal
from .models import Game, User


@dataclass
class OnlineUser:
    user_id: int
    username: str
    rating: int
    ws: WebSocket
    game_id: Optional[str] = None


@dataclass
class LiveGame:
    id: str
    white_id: int
    black_id: int
    white_name: str
    black_name: str
    board: chess.Board = field(default_factory=chess.Board)
    over: bool = False
    # 클럭 (밀리초)
    white_ms: int = 600_000
    black_ms: int = 600_000
    increment_ms: int = 0
    last_ts: float = field(default_factory=lambda: time.time())  # 마지막 시계 갱신 시각
    # 무승부 제안 중인 사용자 id (없으면 None)
    draw_offer_by: Optional[int] = None

    def _tick(self) -> None:
        """경과 시간을 현재 둘 차례 플레이어 시계에서 차감."""
        now = time.time()
        elapsed = int((now - self.last_ts) * 1000)
        self.last_ts = now
        if self.board.turn == chess.WHITE:
            self.white_ms = max(0, self.white_ms - elapsed)
        else:
            self.black_ms = max(0, self.black_ms - elapsed)

    def clocks(self) -> dict:
        return {"white": self.white_ms, "black": self.black_ms}


class GameServer:
    def __init__(self) -> None:
        self.online: dict[int, OnlineUser] = {}
        self.games: dict[str, LiveGame] = {}
        # 대기 중인 도전: (보낸사람, 받는사람) -> {"minutes","increment"}
        self.pending: dict[tuple[int, int], dict] = {}
        self._lock = asyncio.Lock()
        self._watcher_started = False
        self.loop = None  # 이벤트 루프 (REST→WS 푸시용)

    def set_loop(self, loop) -> None:
        self.loop = loop

    def notify(self, user_id: int, payload: dict) -> None:
        """동기(REST) 컨텍스트에서 온라인 사용자에게 실시간 메시지 푸시."""
        if user_id not in self.online or self.loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._send(user_id, payload), self.loop)
        except Exception:
            pass

    # ---------- 시간초과 감시 백그라운드 태스크 ----------
    def ensure_watcher(self) -> None:
        if self._watcher_started:
            return
        self._watcher_started = True
        try:
            asyncio.get_event_loop().create_task(self._flag_watcher())
        except RuntimeError:
            pass

    async def _flag_watcher(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            for game in list(self.games.values()):
                if game.over:
                    continue
                game._tick()
                if game.white_ms <= 0:
                    await self._finish_game(game, winner_id=game.black_id, reason="timeout")
                elif game.black_ms <= 0:
                    await self._finish_game(game, winner_id=game.white_id, reason="timeout")
                else:
                    # 주기적 클럭 동기화
                    await self._broadcast_game(game, {"type": "clock", "clocks": game.clocks()})

    # ---------- 연결 관리 ----------
    async def connect(self, ws: WebSocket, user: User) -> None:
        await ws.accept()
        self.ensure_watcher()
        self.online[user.id] = OnlineUser(
            user_id=user.id, username=user.username,
            rating=round(user.rating), ws=ws,
        )
        await self._send(user.id, {"type": "welcome", "you": {
            "id": user.id, "username": user.username, "rating": round(user.rating),
        }})
        await self.broadcast_players()

    async def disconnect(self, user_id: int) -> None:
        ou = self.online.pop(user_id, None)
        # 이 사용자와 관련된 대기 중 도전 정리 + 상대에게 취소 통보
        for (from_id, to_id) in self._clear_pending_for(user_id):
            other = to_id if from_id == user_id else from_id
            await self._send(other, {
                "type": "challenge_cancelled", "fromId": from_id, "byMe": False,
                "fromName": ou.username if ou else "상대",
                "message": "상대가 접속을 종료했습니다.",
            })
        if ou and ou.game_id:
            game = self.games.get(ou.game_id)
            if game and not game.over:
                winner_id = game.black_id if user_id == game.white_id else game.white_id
                await self._finish_game(game, winner_id=winner_id, reason="abandon")
        await self.broadcast_players()

    # ---------- 송신 유틸 ----------
    async def _send(self, user_id: int, payload: dict) -> None:
        ou = self.online.get(user_id)
        if not ou:
            return
        try:
            await ou.ws.send_json(payload)
        except Exception:
            pass

    async def _broadcast_game(self, game: LiveGame, payload: dict) -> None:
        await self._send(game.white_id, payload)
        await self._send(game.black_id, payload)

    def online_list(self) -> list[dict]:
        return [
            {"id": ou.user_id, "username": ou.username, "rating": ou.rating,
             "inGame": ou.game_id is not None}
            for ou in self.online.values()
        ]

    async def broadcast_players(self) -> None:
        payload = {"type": "players", "players": self.online_list()}
        for ou in list(self.online.values()):
            try:
                await ou.ws.send_json(payload)
            except Exception:
                pass

    # ---------- 메시지 디스패치 ----------
    async def handle(self, user_id: int, data: dict) -> None:
        t = data.get("type")
        if t == "challenge":
            await self._on_challenge(user_id, data)
        elif t == "challenge_response":
            await self._on_challenge_response(user_id, data)
        elif t == "challenge_cancel":
            await self._on_challenge_cancel(user_id, data)
        elif t == "rematch":
            await self._on_rematch(user_id, data)
        elif t == "move":
            await self._on_move(user_id, data)
        elif t == "resign":
            await self._on_resign(user_id)
        elif t == "chat":
            await self._on_chat(user_id, data)
        elif t == "draw_offer":
            await self._on_draw_offer(user_id)
        elif t == "draw_response":
            await self._on_draw_response(user_id, data)
        elif t == "list_players":
            await self._send(user_id, {"type": "players", "players": self.online_list()})
        elif t == "ping":
            await self._send(user_id, {"type": "pong"})

    # ---------- 도전 ----------
    async def _on_challenge(self, from_id: int, data: dict) -> None:
        to_id = data.get("toId")
        challenger = self.online.get(from_id)
        target = self.online.get(to_id)
        if not challenger or not target:
            await self._send(from_id, {"type": "error", "message": "상대가 오프라인입니다."})
            return
        if challenger.game_id or target.game_id:
            await self._send(from_id, {"type": "error", "message": "이미 대국 중인 플레이어입니다."})
            return
        minutes = int(data.get("minutes", 10))
        increment = int(data.get("increment", 0))
        # 같은 상대에게 중복 도전 방지
        if (from_id, to_id) in self.pending:
            await self._send(from_id, {"type": "error", "message": "이미 도전을 보냈습니다."})
            return
        self.pending[(from_id, to_id)] = {"minutes": minutes, "increment": increment}
        await self._send(to_id, {
            "type": "incoming_challenge", "fromId": from_id,
            "fromName": challenger.username, "fromRating": challenger.rating,
            "minutes": minutes, "increment": increment,
        })
        await self._send(from_id, {
            "type": "challenge_sent", "toId": to_id, "toName": target.username,
            "minutes": minutes, "increment": increment,
        })

    async def _on_challenge_response(self, responder_id: int, data: dict) -> None:
        from_id = data.get("fromId")
        accept = bool(data.get("accept"))
        responder = self.online.get(responder_id)
        challenger = self.online.get(from_id)
        key = (from_id, responder_id)

        # 이미 취소되었거나 만료된 도전
        if key not in self.pending:
            await self._send(responder_id, {"type": "challenge_gone",
                                            "message": "이 도전은 취소되었거나 만료되었습니다."})
            return
        info = self.pending.pop(key)

        if not responder or not challenger:
            return
        if not accept:
            await self._send(from_id, {"type": "challenge_declined", "byName": responder.username})
            return
        if responder.game_id or challenger.game_id:
            await self._send(from_id, {"type": "error", "message": "도전을 시작할 수 없습니다."})
            return
        minutes = int(data.get("minutes", info.get("minutes", 10)))
        increment = int(data.get("increment", info.get("increment", 0)))
        # 이 두 사람 사이의 다른 대기 도전도 정리
        self._clear_pending_between(from_id, responder_id)
        await self._start_game(challenger.user_id, responder.user_id, minutes, increment)

    async def _on_challenge_cancel(self, from_id: int, data: dict) -> None:
        """보낸 도전을 취소한다."""
        to_id = data.get("toId")
        key = (from_id, to_id)
        if key not in self.pending:
            await self._send(from_id, {"type": "error", "message": "취소할 도전이 없습니다."})
            return
        self.pending.pop(key, None)
        challenger = self.online.get(from_id)
        name = challenger.username if challenger else "상대"
        await self._send(from_id, {"type": "challenge_cancelled", "toId": to_id, "byMe": True})
        await self._send(to_id, {"type": "challenge_cancelled", "fromId": from_id,
                                 "fromName": name, "byMe": False})

    async def _on_rematch(self, from_id: int, data: dict) -> None:
        """직전 상대에게 재대국을 신청한다(도전과 동일한 흐름)."""
        await self._on_challenge(from_id, data)

    def _clear_pending_between(self, a_id: int, b_id: int) -> None:
        for key in [(a_id, b_id), (b_id, a_id)]:
            self.pending.pop(key, None)

    def _clear_pending_for(self, user_id: int) -> list[tuple[int, int]]:
        """이 사용자와 관련된 모든 대기 도전 제거. 제거된 키 목록 반환."""
        removed = [k for k in self.pending if k[0] == user_id or k[1] == user_id]
        for k in removed:
            self.pending.pop(k, None)
        return removed

    # ---------- 대국 시작 ----------
    async def _start_game(self, a_id: int, b_id: int, minutes: int = 10, increment: int = 0) -> None:
        if secrets.randbelow(2) == 0:
            white_id, black_id = a_id, b_id
        else:
            white_id, black_id = b_id, a_id

        white = self.online[white_id]
        black = self.online[black_id]
        base_ms = max(1, minutes) * 60_000

        game_id = secrets.token_hex(8)
        game = LiveGame(
            id=game_id, white_id=white_id, black_id=black_id,
            white_name=white.username, black_name=black.username,
            white_ms=base_ms, black_ms=base_ms, increment_ms=increment * 1000,
            last_ts=time.time(),
        )
        self.games[game_id] = game
        white.game_id = game_id
        black.game_id = game_id

        start_fen = game.board.fen()
        common = {"type": "game_start", "gameId": game_id, "fen": start_fen,
                  "clocks": game.clocks(), "increment": increment}
        await self._send(white_id, {**common, "color": "white",
                                    "opponent": {"id": black_id, "name": black.username,
                                                 "rating": black.rating}})
        await self._send(black_id, {**common, "color": "black",
                                    "opponent": {"id": white_id, "name": white.username,
                                                 "rating": white.rating}})
        await self.broadcast_players()

    # ---------- 수 처리 ----------
    async def _on_move(self, user_id: int, data: dict) -> None:
        game_id = data.get("gameId")
        uci = data.get("uci", "")
        game = self.games.get(game_id)
        ou = self.online.get(user_id)
        if not game or game.over or not ou or ou.game_id != game_id:
            return

        is_white_turn = game.board.turn == chess.WHITE
        if (is_white_turn and user_id != game.white_id) or (not is_white_turn and user_id != game.black_id):
            await self._send(user_id, {"type": "invalid_move", "fen": game.board.fen()})
            return

        try:
            move = chess.Move.from_uci(uci)
        except Exception:
            await self._send(user_id, {"type": "invalid_move", "fen": game.board.fen()})
            return
        if move not in game.board.legal_moves:
            await self._send(user_id, {"type": "invalid_move", "fen": game.board.fen()})
            return

        # 클럭: 둔 사람 시간 차감 + 증가초 적용
        game._tick()
        if user_id == game.white_id:
            game.white_ms += game.increment_ms
        else:
            game.black_ms += game.increment_ms

        # 수 두면 진행 중이던 무승부 제안은 자동 취소
        game.draw_offer_by = None

        san = game.board.san(move)
        game.board.push(move)
        fen = game.board.fen()
        clocks = game.clocks()

        opponent_id = game.black_id if user_id == game.white_id else game.white_id
        await self._send(opponent_id, {"type": "opponent_move", "uci": uci, "san": san,
                                       "fen": fen, "clocks": clocks})
        await self._send(user_id, {"type": "move_ack", "uci": uci, "fen": fen, "clocks": clocks})

        if game.board.is_game_over():
            await self._finish_from_board(game)

    async def _on_resign(self, user_id: int) -> None:
        ou = self.online.get(user_id)
        if not ou or not ou.game_id:
            return
        game = self.games.get(ou.game_id)
        if not game or game.over:
            return
        winner_id = game.black_id if user_id == game.white_id else game.white_id
        await self._finish_game(game, winner_id=winner_id, reason="resign")

    # ---------- 채팅 ----------
    async def _on_chat(self, user_id: int, data: dict) -> None:
        ou = self.online.get(user_id)
        if not ou or not ou.game_id:
            return
        game = self.games.get(ou.game_id)
        if not game:
            return
        text = str(data.get("text", ""))[:300].strip()
        if not text:
            return
        payload = {"type": "chat", "from": ou.username, "text": text, "self": False}
        opponent_id = game.black_id if user_id == game.white_id else game.white_id
        await self._send(opponent_id, payload)
        await self._send(user_id, {**payload, "self": True})

    # ---------- 무승부 제안 ----------
    async def _on_draw_offer(self, user_id: int) -> None:
        ou = self.online.get(user_id)
        if not ou or not ou.game_id:
            return
        game = self.games.get(ou.game_id)
        if not game or game.over:
            return
        game.draw_offer_by = user_id
        opponent_id = game.black_id if user_id == game.white_id else game.white_id
        await self._send(opponent_id, {"type": "draw_offered", "fromName": ou.username})
        await self._send(user_id, {"type": "draw_sent"})

    async def _on_draw_response(self, user_id: int, data: dict) -> None:
        ou = self.online.get(user_id)
        if not ou or not ou.game_id:
            return
        game = self.games.get(ou.game_id)
        if not game or game.over or game.draw_offer_by is None:
            return
        # 본인이 낸 제안에는 응답 불가
        if game.draw_offer_by == user_id:
            return
        accept = bool(data.get("accept"))
        offerer_id = game.draw_offer_by
        game.draw_offer_by = None
        if accept:
            await self._finish_game(game, winner_id=None, reason="agreement")
        else:
            await self._send(offerer_id, {"type": "draw_declined", "byName": ou.username})

    # ---------- 대국 종료 + 레이팅 갱신 ----------
    async def _finish_from_board(self, game: LiveGame) -> None:
        board = game.board
        if board.is_checkmate():
            winner_id = game.black_id if board.turn == chess.WHITE else game.white_id
            await self._finish_game(game, winner_id=winner_id, reason="checkmate")
        else:
            reason = "stalemate" if board.is_stalemate() else "draw"
            await self._finish_game(game, winner_id=None, reason=reason)

    async def _finish_game(self, game: LiveGame, winner_id: Optional[int], reason: str) -> None:
        if game.over:
            return
        game.over = True

        if winner_id is None:
            white_score, result_str = 0.5, "1/2-1/2"
        elif winner_id == game.white_id:
            white_score, result_str = 1.0, "1-0"
        else:
            white_score, result_str = 0.0, "0-1"

        white_delta = black_delta = 0.0
        new_white_rating = new_black_rating = None

        db = SessionLocal()
        try:
            white = db.query(User).filter(User.id == game.white_id).first()
            black = db.query(User).filter(User.id == game.black_id).first()
            if white and black:
                white_delta, black_delta = glicko.update_pair(white, black, white_score)
                if white_score == 1.0:
                    white.wins += 1; black.losses += 1
                elif white_score == 0.0:
                    white.losses += 1; black.wins += 1
                else:
                    white.draws += 1; black.draws += 1
                new_white_rating = round(white.rating)
                new_black_rating = round(black.rating)
                # 대국 종료도 활동 → 스트릭 갱신
                streak.update_streak(white)
                streak.update_streak(black)
                db.add(Game(
                    white_id=game.white_id, black_id=game.black_id,
                    white_name=game.white_name, black_name=game.black_name,
                    result=result_str, reason=reason, pgn=self._board_pgn(game.board),
                    white_rating_change=white_delta, black_rating_change=black_delta,
                ))
                db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

        await self._notify_result(game.white_id, winner_id, white_delta, new_white_rating, reason)
        await self._notify_result(game.black_id, winner_id, black_delta, new_black_rating, reason)

        for uid in (game.white_id, game.black_id):
            ou = self.online.get(uid)
            if ou and ou.game_id == game.id:
                ou.game_id = None
                if new_white_rating is not None and uid == game.white_id:
                    ou.rating = new_white_rating
                if new_black_rating is not None and uid == game.black_id:
                    ou.rating = new_black_rating
        self.games.pop(game.id, None)
        await self.broadcast_players()

    async def _notify_result(self, user_id, winner_id, delta, new_rating, reason):
        if winner_id is None:
            outcome = "draw"
        elif winner_id == user_id:
            outcome = "win"
        else:
            outcome = "loss"
        await self._send(user_id, {
            "type": "game_over", "outcome": outcome, "reason": reason,
            "ratingDelta": round(delta), "newRating": new_rating,
        })

    @staticmethod
    def _board_pgn(board: chess.Board) -> str:
        try:
            import chess.pgn
            g = chess.pgn.Game.from_board(board)
            return str(g)
        except Exception:
            return " ".join(m.uci() for m in board.move_stack)


server = GameServer()
