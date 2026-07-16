"""통찰(Insights) — 내 체스를 데이터로 들여다본다.

제공 항목
  1. 레이팅 추이 (시간순)
  2. 승/패/무 — 전체 · 색깔별
  3. 시간 제어별 성적
  4. 종료 유형 (체크메이트/기권/시간초과/무승부…)
  5. 오프닝 성과 (백/흑 각각, 승률 순)
  6. 상대 실력대별 성적 (나보다 강한/비슷한/약한)
  7. 게임 길이 분포 (수순 길이)
  8. 연승/연패 기록
  9. 정확도 추이 (게임 리뷰 결과 기반)
 10. 수 분류 분포 (블런더/실수/부정확 등)
 11. 활동 패턴 (요일 × 시간대 히트맵)
 12. 훈련 현황 (퍼즐/러시/전투/시각/오프닝)
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Optional

import chess
from sqlalchemy.orm import Session

from . import openings as op
from .models import (BattleSession, Game, GameReview, OpeningProgress,
                     PuzzleAttempt, ReviewMove, RushSession, User, VisionScore)

MAX_GAMES = 500


def _games_of(db: Session, user: User, days: int = 0) -> list[Game]:
    q = db.query(Game).filter((Game.white_id == user.id) | (Game.black_id == user.id))
    if days > 0:
        since = datetime.utcnow() - timedelta(days=days)
        q = q.filter(Game.created_at >= since)
    return q.order_by(Game.id.asc()).limit(MAX_GAMES).all()


def _outcome(g: Game, user_id: int) -> str:
    me_white = (g.white_id == user_id)
    if g.result == "1/2-1/2":
        return "draw"
    if (g.result == "1-0") == me_white:
        return "win"
    return "loss"


def _tc_label(g: Game) -> str:
    m = g.minutes or 0
    if m <= 0:
        return "기타"
    if m < 3:
        return "불릿 (1–2분)"
    if m < 10:
        return "블리츠 (3–9분)"
    if m < 30:
        return "래피드 (10–29분)"
    return "클래식 (30분+)"


def _wdl_dict() -> dict:
    return {"win": 0, "loss": 0, "draw": 0}


def _rate(d: dict) -> float:
    total = d["win"] + d["loss"] + d["draw"]
    if not total:
        return 0.0
    return round((d["win"] + d["draw"] * 0.5) / total * 100, 1)


# ---------------------------------------------------------------------------
def build(db: Session, user: User, days: int = 0) -> dict:
    games = _games_of(db, user, days)
    uid = user.id

    # ---- 1. 레이팅 추이 ----
    rating_points = []
    for g in games:
        me_white = (g.white_id == uid)
        after = g.white_rating_after if me_white else g.black_rating_after
        if not after:
            continue
        rating_points.append({
            "ts": g.created_at.isoformat() if g.created_at else "",
            "rating": round(after),
            "change": round((g.white_rating_change if me_white else g.black_rating_change) or 0, 1),
            "outcome": _outcome(g, uid),
        })

    # ---- 2~4. 색깔별 / 시간제어 / 종료유형 ----
    overall = _wdl_dict()
    by_color = {"white": _wdl_dict(), "black": _wdl_dict()}
    by_tc: dict[str, dict] = defaultdict(_wdl_dict)
    terminations = Counter()
    ply_buckets = Counter()
    by_opponent: dict[str, dict] = {
        "stronger": _wdl_dict(), "similar": _wdl_dict(), "weaker": _wdl_dict(),
    }

    # 상대 레이팅 추정용
    user_rating = user.rating

    for g in games:
        me_white = (g.white_id == uid)
        oc = _outcome(g, uid)
        overall[oc] += 1
        by_color["white" if me_white else "black"][oc] += 1
        by_tc[_tc_label(g)][oc] += 1
        terminations[g.reason or "기타"] += 1

        plies = g.ply_count or 0
        if plies:
            if plies < 20:
                ply_buckets["~10수"] += 1
            elif plies < 40:
                ply_buckets["10–20수"] += 1
            elif plies < 60:
                ply_buckets["20–30수"] += 1
            elif plies < 80:
                ply_buckets["30–40수"] += 1
            else:
                ply_buckets["40수+"] += 1

        # 상대 레이팅 (대국 후 상대 레이팅으로 근사)
        opp_after = g.black_rating_after if me_white else g.white_rating_after
        if opp_after:
            diff = opp_after - user_rating
            band = "similar" if abs(diff) <= 100 else ("stronger" if diff > 0 else "weaker")
            by_opponent[band][oc] += 1

    # ---- 5. 오프닝 성과 ----
    def opening_family(name: str) -> str:
        return name.split(":")[0].strip()

    op_stats: dict[str, dict] = {}
    for g in games:
        pgn = (g.pgn or "").strip()
        if not pgn:
            continue
        sans = [t for t in pgn.replace("\n", " ").split()
                if t and not t[0].isdigit() and t not in ("1-0", "0-1", "1/2-1/2", "*")]
        if not sans:
            continue
        info = op.lookup(sans[:20])
        if not info:
            continue
        fam = opening_family(info["name"])
        me_white = (g.white_id == uid)
        key = f"{fam}|{'white' if me_white else 'black'}"
        cell = op_stats.setdefault(key, {
            "opening": fam, "eco": info["eco"],
            "color": "white" if me_white else "black",
            **_wdl_dict(),
        })
        cell[_outcome(g, uid)] += 1

    openings_list = []
    for cell in op_stats.values():
        total = cell["win"] + cell["loss"] + cell["draw"]
        if total < 1:
            continue
        openings_list.append({
            **cell,
            "games": total,
            "score": _rate(cell),
        })
    openings_list.sort(key=lambda x: (-x["games"], -x["score"]))

    best_op = max((o for o in openings_list if o["games"] >= 2), key=lambda x: x["score"], default=None)
    worst_op = min((o for o in openings_list if o["games"] >= 2), key=lambda x: x["score"], default=None)

    # ---- 8. 연승 / 연패 ----
    best_streak = cur_streak = 0
    worst_streak = cur_loss = 0
    for g in games:
        oc = _outcome(g, uid)
        if oc == "win":
            cur_streak += 1
            cur_loss = 0
        elif oc == "loss":
            cur_loss += 1
            cur_streak = 0
        else:
            cur_streak = cur_loss = 0
        best_streak = max(best_streak, cur_streak)
        worst_streak = max(worst_streak, cur_loss)

    # ---- 9~10. 정확도 · 수 분류 (게임 리뷰 기록) ----
    reviews = db.query(GameReview).filter(GameReview.user_id == uid).order_by(
        GameReview.id.asc()).limit(MAX_GAMES).all()
    accuracy_points = [{
        "ts": r.created_at.isoformat() if r.created_at else "",
        "accuracy": round(r.accuracy, 1),
        "estElo": r.est_elo,
        "color": r.color,
    } for r in reviews]

    move_counts = Counter()
    for r in reviews:
        for k, v in r.to_dict()["counts"].items():
            move_counts[k] += v
    total_moves = sum(move_counts.values())
    move_dist = [{
        "kind": k, "count": v,
        "pct": round(v / total_moves * 100, 1) if total_moves else 0.0,
    } for k, v in move_counts.most_common()]

    avg_accuracy = round(sum(r.accuracy for r in reviews) / len(reviews), 1) if reviews else 0.0
    avg_est_elo = round(sum(r.est_elo for r in reviews) / len(reviews)) if reviews else 0

    # ---- 10b. 세부 지표 (수별 상세 ReviewMove 집계) ----
    detailed = _detailed_review_stats(db, uid, reviews)

    # ---- 11. 활동 패턴 (요일 × 시간대) ----
    heat = [[0] * 24 for _ in range(7)]   # 0=월 … 6=일
    for g in games:
        if not g.created_at:
            continue
        heat[g.created_at.weekday()][g.created_at.hour] += 1

    # ---- 12. 훈련 현황 ----
    puzzle_attempts = db.query(PuzzleAttempt).filter(PuzzleAttempt.user_id == uid).count()
    rush_best = max(user.rush_best_3m or 0, user.rush_best_5m or 0, user.rush_best_survival or 0)
    rush_count = db.query(RushSession).filter(RushSession.user_id == uid).count()
    battle_count = db.query(BattleSession).filter(BattleSession.user_id == uid).count()
    vision_count = db.query(VisionScore).filter(VisionScore.user_id == uid).count()
    openings_mastered = db.query(OpeningProgress).filter(
        OpeningProgress.user_id == uid, OpeningProgress.mastered == 1).count()

    return {
        "games": len(games),
        "days": days,
        "rating": {
            "current": round(user.rating),
            "points": rating_points,
            "peak": max([p["rating"] for p in rating_points], default=round(user.rating)),
            "low": min([p["rating"] for p in rating_points], default=round(user.rating)),
        },
        "overall": {**overall, "score": _rate(overall)},
        "byColor": {
            "white": {**by_color["white"], "score": _rate(by_color["white"])},
            "black": {**by_color["black"], "score": _rate(by_color["black"])},
        },
        "byTimeControl": [
            {"label": k, **v, "score": _rate(v), "games": v["win"] + v["loss"] + v["draw"]}
            for k, v in sorted(by_tc.items(), key=lambda x: -(x[1]["win"] + x[1]["loss"] + x[1]["draw"]))
        ],
        "byOpponent": {
            k: {**v, "score": _rate(v), "games": v["win"] + v["loss"] + v["draw"]}
            for k, v in by_opponent.items()
        },
        "terminations": [{"reason": k, "count": v} for k, v in terminations.most_common()],
        "gameLength": [{"bucket": k, "count": v} for k, v in ply_buckets.most_common()],
        "openings": openings_list[:20],
        "bestOpening": best_op,
        "worstOpening": worst_op,
        "streaks": {"bestWin": best_streak, "worstLoss": worst_streak,
                    "loginBest": user.streak_best, "loginCurrent": user.streak_current},
        "accuracy": {
            "points": accuracy_points,
            "average": avg_accuracy,
            "estElo": avg_est_elo,
            "reviews": len(reviews),
        },
        "moveDistribution": move_dist,
        "detailed": detailed,
        "activity": heat,
        "training": {
            "puzzleRating": round(user.puzzle_rating),
            "puzzlesSolved": user.puzzles_solved,
            "puzzlesFailed": user.puzzles_failed,
            "puzzleAttempts": puzzle_attempts,
            "rushBest": rush_best,
            "rushSessions": rush_count,
            "battleWins": user.battle_wins or 0,
            "battleLosses": user.battle_losses or 0,
            "battleSessions": battle_count,
            "visionCoords": user.vision_best_coords or 0,
            "visionMoves": user.vision_best_moves or 0,
            "visionSessions": vision_count,
            "openingsMastered": openings_mastered,
        },
    }


def save_review(db: Session, user: User, data: dict) -> GameReview:
    """분석 페이지의 게임 리뷰 결과를 저장한다.

    요약(GameReview) + **수별 상세(ReviewMove)** 를 함께 저장해야
    통찰의 세부 지표(수 번호별 정확도, 기물별 정확도, 캐슬링, 단계별 등)를 낼 수 있다.
    """
    counts = data.get("counts") or {}

    def c(k: str) -> int:
        return max(0, min(int(counts.get(k) or 0), 500))

    game_id = data.get("gameId")
    game_id = int(game_id) if game_id else None
    color = "black" if str(data.get("color")) == "black" else "white"

    moves = data.get("moves") or []
    end_phase = moves[-1]["phase"] if moves else ""

    # 이 게임의 내 결과 (있으면)
    result = ""
    if game_id:
        g = db.query(Game).filter(Game.id == game_id).first()
        if g:
            result = _outcome(g, user.id)

    # 같은 게임을 다시 리뷰하면 기존 것을 대체 (중복 통계 방지)
    if game_id:
        old = db.query(GameReview).filter(
            GameReview.user_id == user.id, GameReview.game_id == game_id
        ).all()
        for o in old:
            db.query(ReviewMove).filter(ReviewMove.review_id == o.id).delete()
            db.delete(o)
        db.commit()

    r = GameReview(
        user_id=user.id,
        game_id=game_id,
        color=color,
        accuracy=max(0.0, min(float(data.get("accuracy") or 0), 100.0)),
        est_elo=max(0, min(int(data.get("estElo") or 0), 4000)),
        avg_loss=max(0.0, min(float(data.get("avgLoss") or 0), 100.0)),
        tactics_total=max(0, min(int(data.get("tacticsTotal") or 0), 400)),
        tactics_found=max(0, min(int(data.get("tacticsFound") or 0), 400)),
        opponent_accuracy=max(0.0, min(float(data.get("opponentAccuracy") or 0), 100.0)),
        result=result,
        end_phase=end_phase[:12],
        game_shape=str(data.get("gameShape") or "")[:16],
        brilliant=c("brilliant"), great=c("great"), best=c("best"),
        excellent=c("excellent"), good=c("good"), book=c("book"),
        forced=c("forced"), inaccuracy=c("inaccuracy"), mistake=c("mistake"),
        missed=c("missed"), blunder=c("blunder"),
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    # 수별 상세
    for m in moves[:400]:
        db.add(ReviewMove(
            review_id=r.id,
            user_id=user.id,
            ply=int(m.get("ply") or 0),
            move_no=int(m.get("moveNo") or 0),
            color=("black" if str(m.get("color")) == "black" else "white"),
            san=str(m.get("san") or "")[:12],
            piece=str(m.get("piece") or "")[:1],
            from_sq=str(m.get("from") or "")[:2],
            to_sq=str(m.get("to") or "")[:2],
            classification=str(m.get("classification") or "good")[:12],
            accuracy=max(0.0, min(float(m.get("accuracy") or 0), 100.0)),
            loss=max(0.0, min(float(m.get("loss") or 0), 100.0)),
            phase=str(m.get("phase") or "middlegame")[:12],
            is_capture=1 if m.get("isCapture") else 0,
            is_castle=1 if m.get("isCastle") else 0,
            castle_side=str(m.get("castleSide") or "")[:6],
            is_check=1 if m.get("isCheck") else 0,
            is_promotion=1 if m.get("isPromotion") else 0,
            is_book=1 if m.get("isBook") else 0,
            is_best=1 if m.get("isBest") else 0,
            is_tactic=1 if m.get("isTactic") else 0,
            tactic_found=1 if m.get("tacticFound") else 0,
        ))
    db.commit()
    return r


# ---------------------------------------------------------------------------
# 세부 리뷰 지표 — 수별 상세(ReviewMove) + 리뷰 요약(GameReview) 집계
# ---------------------------------------------------------------------------
_PIECE_KO = {"p": "폰", "n": "나이트", "b": "비숍", "r": "룩", "q": "퀸", "k": "킹"}
_PHASE_KO = {"opening": "오프닝", "middlegame": "미들게임", "endgame": "엔드게임"}
_SHAPE_KO = {
    "wire_to_wire": "시종 우세", "comeback": "역전", "collapse": "리드 상실",
    "seesaw": "시소(엎치락뒤치락)", "even": "균형·접전", "crush": "압도", "crushed": "완패",
}
_RESULT_KO = {"win": "승", "loss": "패", "draw": "무"}


def _avg(lst) -> float:
    return round(sum(lst) / len(lst), 1) if lst else 0.0


def _detailed_review_stats(db, uid: int, reviews: list) -> dict:
    """게임 리뷰가 쌓여 있어야 채워지는 세부 지표.

    - 결과별/단계별/기물별/수번호별 정확도
    - 기물별 움직임 수, 캐슬링 빈도·시점
    - 전술 포착률, 이론 수 평균
    - 종료 단계 분포·단계별 결과, 게임 양상(분포·결과·정확도)
    """
    review_ids = {r.id for r in reviews}
    empty = {"hasData": False}
    if not review_ids:
        return empty

    # 수별 상세
    try:
        moves = db.query(ReviewMove).filter(ReviewMove.user_id == uid).limit(40000).all()
    except Exception:
        moves = []
    moves = [m for m in moves if m.review_id in review_ids]

    # ---- 결과별 정확도 (이길 때/비길 때/질 때/총합) ----
    acc_by_result = {"win": [], "loss": [], "draw": []}
    for r in reviews:
        if r.result in acc_by_result:
            acc_by_result[r.result].append(r.accuracy)
    accuracy_by_result = {
        k: {"accuracy": _avg(v), "games": len(v), "ko": _RESULT_KO[k]}
        for k, v in acc_by_result.items()
    }
    all_acc = [r.accuracy for r in reviews]
    accuracy_by_result["overall"] = {"accuracy": _avg(all_acc), "games": len(all_acc), "ko": "총합"}

    # ---- 단계별 / 기물별 / 수번호별 정확도, 기물별 움직임 ----
    phase_acc = defaultdict(list)
    piece_acc = defaultdict(list)
    piece_moves = Counter()
    movenum_acc = defaultdict(list)     # 버킷 → [acc]
    castle = {"king": 0, "queen": 0, "moves": [], "gamesCastled": set()}
    tactic_total = tactic_found = 0

    def _bucket(no: int) -> str:
        if no <= 10: return "1–10수"
        if no <= 20: return "11–20수"
        if no <= 30: return "21–30수"
        if no <= 40: return "31–40수"
        return "41수+"
    BUCKET_ORDER = ["1–10수", "11–20수", "21–30수", "31–40수", "41수+"]

    for m in moves:
        # 이론/강제 수는 정확도 평균에서 제외(실력 무관)
        countable = m.classification not in ("book", "forced")
        if m.phase and countable:
            phase_acc[m.phase].append(m.accuracy)
        if m.piece:
            piece_moves[m.piece] += 1
            if countable:
                piece_acc[m.piece].append(m.accuracy)
        if m.move_no and countable:
            movenum_acc[_bucket(m.move_no)].append(m.accuracy)
        if m.is_castle:
            side = m.castle_side if m.castle_side in ("king", "queen") else "king"
            castle[side] += 1
            if m.move_no:
                castle["moves"].append(m.move_no)
            castle["gamesCastled"].add(m.review_id)
        if m.is_tactic:
            tactic_total += 1
            if m.tactic_found:
                tactic_found += 1

    accuracy_by_phase = [
        {"key": p, "ko": _PHASE_KO.get(p, p), "accuracy": _avg(v), "moves": len(v)}
        for p, v in sorted(phase_acc.items(), key=lambda x: -len(x[1]))
    ]
    piece_order = ["p", "n", "b", "r", "q", "k"]
    accuracy_by_piece = [
        {"key": p, "ko": _PIECE_KO[p], "accuracy": _avg(piece_acc.get(p, [])),
         "moves": piece_moves.get(p, 0)}
        for p in piece_order if piece_moves.get(p, 0)
    ]
    total_pmoves = sum(piece_moves.values()) or 1
    moves_by_piece = [
        {"key": p, "ko": _PIECE_KO[p], "count": piece_moves.get(p, 0),
         "pct": round(piece_moves.get(p, 0) / total_pmoves * 100, 1)}
        for p in piece_order if piece_moves.get(p, 0)
    ]
    accuracy_by_movenumber = [
        {"bucket": b, "accuracy": _avg(movenum_acc.get(b, [])), "moves": len(movenum_acc.get(b, []))}
        for b in BUCKET_ORDER if movenum_acc.get(b)
    ]

    # ---- 캐슬링 ----
    n_reviews = len(reviews) or 1
    castling = {
        "king": castle["king"], "queen": castle["queen"],
        "total": castle["king"] + castle["queen"],
        "avgMove": round(sum(castle["moves"]) / len(castle["moves"]), 1) if castle["moves"] else 0,
        "castledGames": len(castle["gamesCastled"]),
        "castledPct": round(len(castle["gamesCastled"]) / n_reviews * 100, 1),
        "reviews": len(reviews),
    }

    # ---- 전술 포착 (수별 우선, 없으면 리뷰 요약 합계) ----
    if tactic_total == 0:
        tactic_total = sum(r.tactics_total for r in reviews)
        tactic_found = sum(r.tactics_found for r in reviews)
    tactics = {
        "total": tactic_total, "found": tactic_found, "missed": max(0, tactic_total - tactic_found),
        "foundPct": round(tactic_found / tactic_total * 100, 1) if tactic_total else 0.0,
        "missedPct": round((tactic_total - tactic_found) / tactic_total * 100, 1) if tactic_total else 0.0,
    }

    # ---- 이론(정석) 수 평균 ----
    book_counts = [r.book for r in reviews]
    theory = {
        "avgPerGame": round(sum(book_counts) / len(book_counts), 1) if book_counts else 0.0,
        "total": sum(book_counts), "reviews": len(reviews),
    }

    # ---- 종료 단계 분포 + 단계별 결과 ----
    phase_ended = Counter()
    result_by_end_phase = defaultdict(lambda: {"win": 0, "loss": 0, "draw": 0})
    for r in reviews:
        ph = r.end_phase or "middlegame"
        phase_ended[ph] += 1
        if r.result in ("win", "loss", "draw"):
            result_by_end_phase[ph][r.result] += 1
    ended_by_phase = [
        {"key": p, "ko": _PHASE_KO.get(p, p), "count": c}
        for p, c in phase_ended.most_common()
    ]
    result_by_phase = [
        {"key": p, "ko": _PHASE_KO.get(p, p), **result_by_end_phase[p],
         "score": _rate(result_by_end_phase[p]),
         "games": sum(result_by_end_phase[p].values())}
        for p, _ in phase_ended.most_common()
    ]

    # ---- 게임 양상(분포 · 결과 · 정확도) ----
    shape_bucket = defaultdict(lambda: {"win": 0, "loss": 0, "draw": 0, "acc": []})
    for r in reviews:
        s = r.game_shape or ""
        if not s:
            continue
        cell = shape_bucket[s]
        if r.result in ("win", "loss", "draw"):
            cell[r.result] += 1
        cell["acc"].append(r.accuracy)
    game_shapes = [
        {"key": s, "ko": _SHAPE_KO.get(s, s),
         "win": c["win"], "loss": c["loss"], "draw": c["draw"],
         "games": c["win"] + c["loss"] + c["draw"],
         "score": _rate({"win": c["win"], "loss": c["loss"], "draw": c["draw"]}),
         "accuracy": _avg(c["acc"])}
        for s, c in sorted(shape_bucket.items(), key=lambda x: -(x[1]["win"] + x[1]["loss"] + x[1]["draw"]))
    ]

    return {
        "hasData": True,
        "reviews": len(reviews),
        "movesAnalyzed": len(moves),
        "accuracyByResult": accuracy_by_result,
        "accuracyByPhase": accuracy_by_phase,
        "accuracyByPiece": accuracy_by_piece,
        "movesByPiece": moves_by_piece,
        "accuracyByMoveNumber": accuracy_by_movenumber,
        "castling": castling,
        "tactics": tactics,
        "theory": theory,
        "endedByPhase": ended_by_phase,
        "resultByPhase": result_by_phase,
        "gameShapes": game_shapes,
    }
