"""오프닝 배우기 — 커리큘럼 + 진도 관리.

3,800종 전체를 다 외울 필요는 없다. 실전에서 가장 자주 나오는 오프닝을
**단계별 커리큘럼**으로 묶어, 수순을 익히고(학습) → 외워서 두는(퀴즈) 흐름을 만든다.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from . import openings as op
from .models import OpeningProgress, User

# 커리큘럼: (단계, 설명, [오프닝 이름들])
# 이름은 Lichess DB 의 정식 명칭과 정확히 일치해야 한다(아래에서 검증).
CURRICULUM: list[dict] = [
    {
        "id": "e4_basics",
        "level": 1,
        "title": "1.e4 기본",
        "desc": "가장 흔한 첫 수. 열린 게임의 기초를 익힙니다.",
        "openings": [
            "Italian Game",
            "Ruy Lopez",
            "Scotch Game",
            "Vienna Game",
            "King's Gambit",
        ],
    },
    {
        "id": "e4_defenses",
        "level": 2,
        "title": "1.e4 에 대한 방어",
        "desc": "흑으로 e4 를 상대하는 대표적인 방법들.",
        "openings": [
            "Sicilian Defense",
            "French Defense",
            "Caro-Kann Defense",
            "Scandinavian Defense",
            "Pirc Defense",
            "Alekhine Defense",
        ],
    },
    {
        "id": "d4_basics",
        "level": 3,
        "title": "1.d4 기본",
        "desc": "닫힌 게임. 구조적인 이해가 중요합니다.",
        "openings": [
            "Queen's Gambit",
            "Queen's Gambit Declined",
            "Queen's Gambit Accepted",
            "Slav Defense",
            "Queen's Pawn Game: London System",
        ],
    },
    {
        "id": "indian",
        "level": 4,
        "title": "인디언 디펜스",
        "desc": "1.d4 에 대한 현대적인 대응.",
        "openings": [
            "Indian Defense",
            "Nimzo-Indian Defense",
            "King's Indian Defense",
            "Queen's Indian Defense",
            "Grünfeld Defense",
            "Benoni Defense",
        ],
    },
    {
        "id": "flank",
        "level": 5,
        "title": "측면 오프닝",
        "desc": "e4/d4 가 아닌 첫 수들.",
        "openings": [
            "English Opening",
            "Réti Opening",
            "Bird Opening",
            "Dutch Defense",
        ],
    },
    {
        "id": "sicilian_deep",
        "level": 6,
        "title": "시실리안 심화",
        "desc": "가장 인기 있는 방어의 주요 변형들.",
        "openings": [
            "Sicilian Defense: Najdorf Variation",
            "Sicilian Defense: Dragon Variation",
            "Sicilian Defense: Accelerated Dragon",
            "Sicilian Defense: Alapin Variation",
            "Sicilian Defense: Closed",
        ],
    },
    {
        "id": "traps",
        "level": 7,
        "title": "함정과 갬빗",
        "desc": "알아두면 이기고, 모르면 당하는 수순들.",
        "openings": [
            "Italian Game: Two Knights Defense, Fried Liver Attack",
            "Italian Game: Evans Gambit",
            "Indian Defense: Budapest Gambit",
            "Englund Gambit",
            "Danish Gambit",
        ],
    },
]


def _find_opening(name: str) -> Optional[dict]:
    """이름으로 오프닝을 찾는다. 정확히 일치하는 것 우선, 없으면 접두 일치."""
    exact = None
    prefix = None
    for eco, oname, moves in op.OPENINGS:
        if oname == name:
            if exact is None or len(moves) < len(exact["moves"]):
                exact = {"eco": eco, "name": oname, "moves": moves}
        elif prefix is None and oname.startswith(name):
            prefix = {"eco": eco, "name": oname, "moves": moves}
    return exact or prefix


def curriculum(db: Session, user: Optional[User] = None) -> list[dict]:
    """커리큘럼 + (로그인 시) 진도."""
    progress: dict[str, dict] = {}
    if user is not None:
        rows = db.query(OpeningProgress).filter(OpeningProgress.user_id == user.id).all()
        progress = {r.opening_key: r.to_dict() for r in rows}

    out = []
    for unit in CURRICULUM:
        items = []
        for name in unit["openings"]:
            found = _find_opening(name)
            if not found:
                continue
            key = f"{found['eco']}|{found['name']}"
            p = progress.get(key)
            items.append({
                "key": key,
                "eco": found["eco"],
                "name": found["name"],
                "moves": found["moves"],
                "plies": len(found["moves"]),
                "attempts": p["attempts"] if p else 0,
                "bestScore": p["bestScore"] if p else 0,
                "mastered": p["mastered"] if p else False,
            })
        if not items:
            continue
        mastered = sum(1 for i in items if i["mastered"])
        out.append({
            "id": unit["id"],
            "level": unit["level"],
            "title": unit["title"],
            "desc": unit["desc"],
            "openings": items,
            "mastered": mastered,
            "total": len(items),
        })
    return out


def record(db: Session, user: User, opening_key: str, score: int) -> dict:
    """퀴즈 결과 저장. score = 정답률 0~100."""
    score = max(0, min(100, int(score)))
    row = db.query(OpeningProgress).filter(
        OpeningProgress.user_id == user.id,
        OpeningProgress.opening_key == opening_key[:160],
    ).first()
    if not row:
        # 새 행은 flush 전이라 컬럼 기본값이 아직 채워지지 않는다 → 명시적으로 초기화
        row = OpeningProgress(user_id=user.id, opening_key=opening_key[:160],
                              attempts=0, best_score=0, mastered=0)
        db.add(row)
    row.attempts = (row.attempts or 0) + 1
    if score > (row.best_score or 0):
        row.best_score = score
    if score >= 90:
        row.mastered = 1
    db.commit()
    return row.to_dict()


def stats(db: Session, user: User) -> dict:
    rows = db.query(OpeningProgress).filter(OpeningProgress.user_id == user.id).all()
    total_units = sum(len(u["openings"]) for u in CURRICULUM)
    return {
        "studied": len(rows),
        "mastered": sum(1 for r in rows if r.mastered),
        "totalOpenings": total_units,
        "attempts": sum(r.attempts for r in rows),
    }
