"""업적(배지) + 알림.

업적은 사용자의 현재 통계를 기준으로 서버에서 판정한다.
새로 달성한 업적은 DB에 저장하고 알림을 만든다.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Achievement, Notification, RushSession, User

# code, 이름, 설명, 아이콘, 판정 함수(user, ctx) -> bool
# ctx: {"rush_best": int, "games": int, ...} 추가 정보
ACHIEVEMENTS: list[dict] = [
    {"code": "first_login", "name": "첫 발자국", "desc": "키위 카를센에 처음 오신 것을 환영합니다.",
     "icon": "🥝", "check": lambda u, c: True},

    # 대국
    {"code": "first_win", "name": "첫 승리", "desc": "온라인 대국에서 처음 이겼습니다.",
     "icon": "🏆", "check": lambda u, c: u.wins >= 1},
    {"code": "win_10", "name": "10승 달성", "desc": "온라인 대국에서 10승을 거뒀습니다.",
     "icon": "🥉", "check": lambda u, c: u.wins >= 10},
    {"code": "win_50", "name": "50승 달성", "desc": "온라인 대국에서 50승을 거뒀습니다.",
     "icon": "🥈", "check": lambda u, c: u.wins >= 50},
    {"code": "win_100", "name": "100승 달성", "desc": "온라인 대국에서 100승을 거뒀습니다.",
     "icon": "🥇", "check": lambda u, c: u.wins >= 100},
    {"code": "games_10", "name": "실전 감각", "desc": "10판을 두었습니다.",
     "icon": "♟️", "check": lambda u, c: (u.wins + u.losses + u.draws) >= 10},
    {"code": "games_100", "name": "백 판의 경험", "desc": "100판을 두었습니다.",
     "icon": "⚔️", "check": lambda u, c: (u.wins + u.losses + u.draws) >= 100},

    # 레이팅
    {"code": "rating_1200", "name": "레이팅 1200", "desc": "레이팅 1200을 넘었습니다.",
     "icon": "📈", "check": lambda u, c: u.rating >= 1200},
    {"code": "rating_1500", "name": "레이팅 1500", "desc": "레이팅 1500을 넘었습니다.",
     "icon": "🚀", "check": lambda u, c: u.rating >= 1500},
    {"code": "rating_1800", "name": "레이팅 1800", "desc": "레이팅 1800을 넘었습니다.",
     "icon": "🌟", "check": lambda u, c: u.rating >= 1800},
    {"code": "rating_2000", "name": "레이팅 2000", "desc": "아마추어의 목표점, 2000을 넘었습니다.",
     "icon": "👑", "check": lambda u, c: u.rating >= 2000},

    # 퍼즐
    {"code": "puzzle_1", "name": "첫 퍼즐", "desc": "퍼즐을 처음 풀었습니다.",
     "icon": "🧩", "check": lambda u, c: u.puzzles_solved >= 1},
    {"code": "puzzle_50", "name": "퍼즐 수련생", "desc": "퍼즐 50개를 풀었습니다.",
     "icon": "📘", "check": lambda u, c: u.puzzles_solved >= 50},
    {"code": "puzzle_200", "name": "퍼즐 장인", "desc": "퍼즐 200개를 풀었습니다.",
     "icon": "📚", "check": lambda u, c: u.puzzles_solved >= 200},
    {"code": "puzzle_1000", "name": "퍼즐 마스터", "desc": "퍼즐 1000개를 풀었습니다.",
     "icon": "🎓", "check": lambda u, c: u.puzzles_solved >= 1000},
    {"code": "puzzle_rating_1500", "name": "퍼즐 레이팅 1500", "desc": "퍼즐 레이팅 1500을 넘었습니다.",
     "icon": "🔍", "check": lambda u, c: u.puzzle_rating >= 1500},
    {"code": "puzzle_rating_2000", "name": "퍼즐 레이팅 2000", "desc": "퍼즐 레이팅 2000을 넘었습니다.",
     "icon": "💎", "check": lambda u, c: u.puzzle_rating >= 2000},

    # 퍼즐 러시
    {"code": "rush_10", "name": "러시 입문", "desc": "퍼즐 러시에서 10점을 넘겼습니다.",
     "icon": "⚡", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 10},
    {"code": "rush_25", "name": "러시 고수", "desc": "퍼즐 러시에서 25점을 넘겼습니다.",
     "icon": "🔥", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 25},
    {"code": "rush_50", "name": "러시 폭주", "desc": "퍼즐 러시에서 50점을 넘겼습니다.",
     "icon": "💥", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 50},

    # 스트릭
    {"code": "streak_3", "name": "3일 연속", "desc": "3일 연속 접속했습니다.",
     "icon": "🌱", "check": lambda u, c: u.streak_best >= 3},
    {"code": "streak_7", "name": "일주일 개근", "desc": "7일 연속 접속했습니다.",
     "icon": "🌿", "check": lambda u, c: u.streak_best >= 7},
    {"code": "streak_30", "name": "한 달 개근", "desc": "30일 연속 접속했습니다.",
     "icon": "🌳", "check": lambda u, c: u.streak_best >= 30},
    {"code": "streak_100", "name": "백일의 키위", "desc": "100일 연속 접속했습니다.",
     "icon": "🏔️", "check": lambda u, c: u.streak_best >= 100},

    # 사교
    {"code": "friend_1", "name": "첫 친구", "desc": "친구를 처음 만들었습니다.",
     "icon": "🤝", "check": lambda u, c: c.get("friends", 0) >= 1},
    {"code": "friend_10", "name": "인기 키위", "desc": "친구가 10명이 되었습니다.",
     "icon": "🎉", "check": lambda u, c: c.get("friends", 0) >= 10},
]

_BY_CODE = {a["code"]: a for a in ACHIEVEMENTS}


def notify(db: Session, user_id: int, kind: str, text: str, link: str = "") -> Notification:
    """알림 생성."""
    n = Notification(user_id=user_id, kind=kind, text=text[:300], link=link[:120])
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def evaluate(db: Session, user: User, ctx: dict | None = None) -> list[dict]:
    """현재 통계로 업적을 판정하고, 새로 달성한 것을 저장 + 알림.

    반환: 이번에 새로 획득한 업적 목록
    """
    ctx = ctx or {}
    earned_codes = {
        a.code for a in db.query(Achievement).filter(Achievement.user_id == user.id).all()
    }
    newly: list[dict] = []
    for spec in ACHIEVEMENTS:
        if spec["code"] in earned_codes:
            continue
        try:
            ok = bool(spec["check"](user, ctx))
        except Exception:
            ok = False
        if ok:
            db.add(Achievement(user_id=user.id, code=spec["code"]))
            newly.append({"code": spec["code"], "name": spec["name"],
                          "desc": spec["desc"], "icon": spec["icon"]})
    if newly:
        db.commit()
        for a in newly:
            notify(db, user.id, "achievement",
                   f"{a['icon']} 업적 달성: {a['name']} — {a['desc']}", "/profile.html")
    return newly


def list_for_user(db: Session, user: User) -> list[dict]:
    """전체 업적 목록 + 획득 여부."""
    rows = {a.code: a for a in db.query(Achievement).filter(Achievement.user_id == user.id).all()}
    out = []
    for spec in ACHIEVEMENTS:
        got = rows.get(spec["code"])
        out.append({
            "code": spec["code"],
            "name": spec["name"],
            "desc": spec["desc"],
            "icon": spec["icon"],
            "earned": bool(got),
            "earnedAt": got.earned_at.isoformat() if got else "",
        })
    return out


def unread_count(db: Session, user_id: int) -> int:
    return db.query(Notification).filter(
        Notification.user_id == user_id, Notification.is_read == 0
    ).count()
