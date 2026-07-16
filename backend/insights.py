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
