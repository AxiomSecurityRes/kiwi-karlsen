"""키위 봇 — 공식 체스 타이틀 기준 레이팅.

FIDE 타이틀 기준선
  GM (그랜드마스터)        2500+
  IM (인터내셔널 마스터)    2400+
  FM (FIDE 마스터)         2300+
  CM (캔디데이트 마스터)    2200+
  Expert / 후보선수         2000+
  Class A                  1800+
  Class B                  1600+
  Class C                  1400+
  Class D                  1200+
  Class E                  1000+
  초보                      1000 미만

각 봇의 approx_rating 이 곧 ELO 강도 모델의 목표 레이팅이다
(engine.py / engine.js 의 elo_params 가 이 값으로 실수 확률·탐색 깊이를 정한다).
"""

BOTS = {
    1: {
        "level": 1, "name": "Kiwi Hatchling", "title": "입문 (Beginner)",
        "approx_rating": 500,
        "skill": 0, "elo": None, "depth": 5, "movetime": 200, "randomness": 0.40,
        "blurb": "이제 막 알을 깨고 나온 아기 키위. 규칙은 알지만 실수가 잦아요.",
        "avatar": "🥚",
    },
    2: {
        "level": 2, "name": "Kiwi Novice", "title": "Class E (1000+)",
        "approx_rating": 1000,
        "skill": 3, "elo": None, "depth": 6, "movetime": 250, "randomness": 0.22,
        "blurb": "기본 전술을 배우는 중. 공짜 기물은 잘 챙깁니다.",
        "avatar": "🐣",
    },
    3: {
        "level": 3, "name": "Kiwi Student", "title": "Class C (1400+)",
        "approx_rating": 1400,
        "skill": 6, "elo": None, "depth": 8, "movetime": 350, "randomness": 0.10,
        "blurb": "포크와 핀을 볼 줄 압니다. 오프닝도 몇 개 외웠어요.",
        "avatar": "📘",
    },
    4: {
        "level": 4, "name": "Kiwi Class A", "title": "Class A (1800+)",
        "approx_rating": 1800,
        "skill": 10, "elo": None, "depth": 10, "movetime": 500, "randomness": 0.04,
        "blurb": "동네 대회 입상권. 어지간한 실수는 놓치지 않습니다.",
        "avatar": "♟️",
    },
    5: {
        "level": 5, "name": "Kiwi Expert", "title": "Expert (2000+)",
        "approx_rating": 2000,
        "skill": 13, "elo": None, "depth": 12, "movetime": 700, "randomness": 0.0,
        "blurb": "아마추어의 목표점. 전술적 빈틈을 정확히 파고듭니다.",
        "avatar": "🎯",
    },
    6: {
        "level": 6, "name": "Kiwi CM", "title": "CM · 캔디데이트 마스터 (2200+)",
        "approx_rating": 2200,
        "skill": 15, "elo": None, "depth": 13, "movetime": 800, "randomness": 0.0,
        "blurb": "캔디데이트 마스터. 포지션 이해도가 높습니다.",
        "avatar": "🎓",
    },
    7: {
        "level": 7, "name": "Kiwi FM", "title": "FM · FIDE 마스터 (2300+)",
        "approx_rating": 2300,
        "skill": 17, "elo": None, "depth": 14, "movetime": 1000, "randomness": 0.0,
        "blurb": "FIDE 마스터. 엔드게임 기술이 날카롭습니다.",
        "avatar": "🥉",
    },
    8: {
        "level": 8, "name": "Kiwi IM", "title": "IM · 인터내셔널 마스터 (2400+)",
        "approx_rating": 2400,
        "skill": 18, "elo": None, "depth": 15, "movetime": 1200, "randomness": 0.0,
        "blurb": "인터내셔널 마스터. 빈틈을 찾기 매우 어렵습니다.",
        "avatar": "🥈",
    },
    9: {
        "level": 9, "name": "Kiwi GM", "title": "GM · 그랜드마스터 (2500+)",
        "approx_rating": 2500,
        "skill": 19, "elo": None, "depth": 17, "movetime": 1500, "randomness": 0.0,
        "blurb": "그랜드마스터. 정확하고 깊게 계산합니다.",
        "avatar": "🥇",
    },
    10: {
        "level": 10, "name": "Kiwi Super GM", "title": "Super GM (2700+)",
        "approx_rating": 2700,
        "skill": 20, "elo": None, "depth": 18, "movetime": 1800, "randomness": 0.0,
        "blurb": "세계 정상급. 실수를 거의 하지 않습니다.",
        "avatar": "👑",
    },
    11: {
        "level": 11, "name": "Kiwi Karlsen", "title": "최고 난이도 (2900+)",
        "approx_rating": 2900,
        "skill": 20, "elo": None, "depth": 20, "movetime": 2500, "randomness": 0.0,
        "blurb": "전설의 키위. 풀 파워 Stockfish. 행운을 빕니다.",
        "avatar": "🦤",
    },
}


def get_bot(level: int) -> dict:
    return BOTS.get(level, BOTS[1])


def list_bots() -> list[dict]:
    return [BOTS[i] for i in sorted(BOTS.keys())]
