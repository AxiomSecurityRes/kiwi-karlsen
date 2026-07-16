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
    {"code": "friend_25", "name": "키위 마당발", "desc": "친구가 25명이 되었습니다.",
     "icon": "🌐", "check": lambda u, c: c.get("friends", 0) >= 25},

    # 대국 — 추가
    {"code": "games_500", "name": "오백 판의 노력", "desc": "500판을 두었습니다.",
     "icon": "🛡️", "check": lambda u, c: (u.wins + u.losses + u.draws) >= 500},
    {"code": "win_250", "name": "250승", "desc": "온라인 대국에서 250승을 거뒀습니다.",
     "icon": "🏵️", "check": lambda u, c: u.wins >= 250},
    {"code": "draw_10", "name": "타협의 달인", "desc": "무승부를 10번 기록했습니다.",
     "icon": "🤝", "check": lambda u, c: u.draws >= 10},
    {"code": "winrate_60", "name": "안정적인 승률", "desc": "20판 이상 두고 승률 60%를 넘겼습니다.",
     "icon": "📊",
     "check": lambda u, c: (u.wins + u.losses + u.draws) >= 20
                           and u.wins / max(1, u.wins + u.losses + u.draws) >= 0.6},
    {"code": "comeback", "name": "불굴의 키위", "desc": "패배 후에도 10판 이상 계속 두었습니다.",
     "icon": "💪", "check": lambda u, c: u.losses >= 10 and u.wins >= 10},

    # 레이팅 — 추가
    {"code": "rating_1000", "name": "레이팅 1000", "desc": "레이팅 1000을 넘었습니다.",
     "icon": "🌱", "check": lambda u, c: u.rating >= 1000},
    {"code": "rating_1400", "name": "레이팅 1400", "desc": "레이팅 1400을 넘었습니다.",
     "icon": "🌿", "check": lambda u, c: u.rating >= 1400},
    {"code": "rating_1600", "name": "레이팅 1600", "desc": "레이팅 1600을 넘었습니다.",
     "icon": "📗", "check": lambda u, c: u.rating >= 1600},
    {"code": "rating_2200", "name": "캔디데이트 마스터급", "desc": "레이팅 2200을 넘었습니다.",
     "icon": "🎓", "check": lambda u, c: u.rating >= 2200},
    {"code": "rating_2400", "name": "인터내셔널 마스터급", "desc": "레이팅 2400을 넘었습니다.",
     "icon": "🥈", "check": lambda u, c: u.rating >= 2400},
    {"code": "rating_2500", "name": "그랜드마스터급", "desc": "레이팅 2500을 넘었습니다.",
     "icon": "🥇", "check": lambda u, c: u.rating >= 2500},

    # 퍼즐 — 추가
    {"code": "puzzle_10", "name": "퍼즐 입문", "desc": "퍼즐 10개를 풀었습니다.",
     "icon": "🔎", "check": lambda u, c: u.puzzles_solved >= 10},
    {"code": "puzzle_100", "name": "퍼즐 백 개", "desc": "퍼즐 100개를 풀었습니다.",
     "icon": "📖", "check": lambda u, c: u.puzzles_solved >= 100},
    {"code": "puzzle_500", "name": "퍼즐 오백 개", "desc": "퍼즐 500개를 풀었습니다.",
     "icon": "📕", "check": lambda u, c: u.puzzles_solved >= 500},
    {"code": "puzzle_2500", "name": "퍼즐 도사", "desc": "퍼즐 2500개를 풀었습니다.",
     "icon": "🧙", "check": lambda u, c: u.puzzles_solved >= 2500},
    {"code": "puzzle_rating_1000", "name": "퍼즐 레이팅 1000", "desc": "퍼즐 레이팅 1000을 넘었습니다.",
     "icon": "🔦", "check": lambda u, c: u.puzzle_rating >= 1000},
    {"code": "puzzle_rating_1800", "name": "퍼즐 레이팅 1800", "desc": "퍼즐 레이팅 1800을 넘었습니다.",
     "icon": "🔭", "check": lambda u, c: u.puzzle_rating >= 1800},
    {"code": "puzzle_rating_2400", "name": "퍼즐 레이팅 2400", "desc": "퍼즐 레이팅 2400을 넘었습니다.",
     "icon": "💠", "check": lambda u, c: u.puzzle_rating >= 2400},
    {"code": "puzzle_persist", "name": "포기하지 않는 키위", "desc": "퍼즐을 100번 틀리고도 계속 도전했습니다.",
     "icon": "🧗", "check": lambda u, c: u.puzzles_failed >= 100},

    # 러시 — 추가
    {"code": "rush_5", "name": "러시 첫 발", "desc": "퍼즐 러시를 한 번 완주했습니다.",
     "icon": "🏁", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 5},
    {"code": "rush_35", "name": "러시 마스터", "desc": "퍼즐 러시에서 35점을 넘겼습니다.",
     "icon": "⚡", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 35},
    {"code": "rush_75", "name": "러시 전설", "desc": "퍼즐 러시에서 75점을 넘겼습니다.",
     "icon": "☄️", "check": lambda u, c: max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 75},
    {"code": "rush_survival_20", "name": "생존 전문가", "desc": "서바이벌 러시에서 20점을 넘겼습니다.",
     "icon": "🪂", "check": lambda u, c: u.rush_best_survival >= 20},

    # 스트릭 — 추가
    {"code": "streak_14", "name": "2주 개근", "desc": "14일 연속 접속했습니다.",
     "icon": "🍀", "check": lambda u, c: u.streak_best >= 14},
    {"code": "streak_60", "name": "두 달 개근", "desc": "60일 연속 접속했습니다.",
     "icon": "🏕️", "check": lambda u, c: u.streak_best >= 60},
    {"code": "streak_365", "name": "일 년의 키위", "desc": "365일 연속 접속했습니다.",
     "icon": "🎆", "check": lambda u, c: u.streak_best >= 365},

    # 프로필 / 기타
    {"code": "profile_done", "name": "자기소개 완료", "desc": "프로필에 자기소개를 작성했습니다.",
     "icon": "✍️", "check": lambda u, c: bool((u.bio or "").strip())},
    {"code": "otb_player", "name": "실전 기사", "desc": "OTB(오프라인) 레이팅을 등록했습니다.",
     "icon": "🏛️", "check": lambda u, c: (u.otb_rating or 0) > 0},
    {"code": "all_rounder", "name": "만능 키위", "desc": "대국 10판 + 퍼즐 50개 + 러시 10점을 모두 달성했습니다.",
     "icon": "🌟",
     "check": lambda u, c: (u.wins + u.losses + u.draws) >= 10 and u.puzzles_solved >= 50
                           and max(u.rush_best_3m, u.rush_best_5m, u.rush_best_survival) >= 10},

    # 퍼즐 전투
    {"code": "battle_first", "name": "첫 전투", "desc": "퍼즐 전투를 처음 치렀습니다.",
     "icon": "⚔️", "check": lambda u, c: (u.battle_wins or 0) + (u.battle_losses or 0) >= 1},
    {"code": "battle_win_1", "name": "첫 전투 승리", "desc": "퍼즐 전투에서 처음 이겼습니다.",
     "icon": "🛡️", "check": lambda u, c: (u.battle_wins or 0) >= 1},
    {"code": "battle_win_10", "name": "전투 베테랑", "desc": "퍼즐 전투에서 10승을 거뒀습니다.",
     "icon": "🏹", "check": lambda u, c: (u.battle_wins or 0) >= 10},
    {"code": "battle_win_50", "name": "전투 챔피언", "desc": "퍼즐 전투에서 50승을 거뒀습니다.",
     "icon": "👑", "check": lambda u, c: (u.battle_wins or 0) >= 50},

    # 시각(Vision) 훈련
    {"code": "vision_first", "name": "눈을 뜨다", "desc": "시각 훈련을 처음 완료했습니다.",
     "icon": "👁️", "check": lambda u, c: max(u.vision_best_coords or 0, u.vision_best_moves or 0) >= 1},
    {"code": "vision_coords_20", "name": "좌표 감각", "desc": "좌표 모드에서 30초에 20개를 맞혔습니다.",
     "icon": "🧭", "check": lambda u, c: (u.vision_best_coords or 0) >= 20},
    {"code": "vision_coords_35", "name": "좌표의 달인", "desc": "좌표 모드에서 30초에 35개를 맞혔습니다.",
     "icon": "🎯", "check": lambda u, c: (u.vision_best_coords or 0) >= 35},
    {"code": "vision_moves_20", "name": "수읽기의 눈", "desc": "수순 모드에서 30초에 20개를 맞혔습니다.",
     "icon": "🔮", "check": lambda u, c: (u.vision_best_moves or 0) >= 20},

    # 오프닝 배우기
    {"code": "learn_first", "name": "첫 정석", "desc": "오프닝을 하나 마스터했습니다.",
     "icon": "📗", "check": lambda u, c: c.get("openingsMastered", 0) >= 1},
    {"code": "learn_10", "name": "정석 수집가", "desc": "오프닝 10개를 마스터했습니다.",
     "icon": "📚", "check": lambda u, c: c.get("openingsMastered", 0) >= 10},
    {"code": "learn_all", "name": "오프닝 마스터", "desc": "커리큘럼의 모든 오프닝을 마스터했습니다.",
     "icon": "🎖️", "check": lambda u, c: c.get("openingsMastered", 0) >= 36},

    # 체스 클럽
    {"code": "club_join", "name": "클럽 입성", "desc": "체스 클럽에 처음 가입했습니다.",
     "icon": "🏰", "check": lambda u, c: c.get("clubsJoined", 0) >= 1},
    {"code": "club_owner", "name": "클럽 개설자", "desc": "직접 체스 클럽을 만들었습니다.",
     "icon": "🗝️", "check": lambda u, c: c.get("clubsOwned", 0) >= 1},
    {"code": "club_social", "name": "사교적인 키위", "desc": "클럽 3개에 가입했습니다.",
     "icon": "🎪", "check": lambda u, c: c.get("clubsJoined", 0) >= 3},
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
