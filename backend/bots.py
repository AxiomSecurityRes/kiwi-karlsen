"""8단계 키위 봇 정의.

각 봇은 Stockfish UCI 옵션(Skill Level / UCI_Elo)과 탐색 한계, 무작위성(randomness)
파라미터를 가진다. 프런트엔드 WASM 엔진과 백엔드 폴백 엔진이 공유한다.
"""

# level: 1..8
BOTS = {
    1: {
        "level": 1, "name": "Kiwi Baby", "title": "입문",
        "approx_rating": 250,
        "skill": 0, "elo": None, "depth": 1, "movetime": 50, "randomness": 0.70,
        "blurb": "이제 막 알을 깨고 나온 아기 키위. 가끔 엉뚱한 수를 둬요.",
        "avatar": "🥝",
    },
    2: {
        "level": 2, "name": "Kiwi Kid", "title": "초보",
        "approx_rating": 600,
        "skill": 1, "elo": None, "depth": 2, "movetime": 100, "randomness": 0.45,
        "blurb": "체스를 배우는 꼬마 키위. 기본기는 아직 부족해요.",
        "avatar": "🐣",
    },
    3: {
        "level": 3, "name": "Kiwi Student / Pupil", "title": "학생",
        "approx_rating": 1000,
        "skill": 4, "elo": None, "depth": 4, "movetime": 200, "randomness": 0.25,
        "blurb": "정석을 공부하는 학생 키위. 전술을 조금씩 알아갑니다.",
        "avatar": "📘",
    },
    4: {
        "level": 4, "name": "Kiwi Player", "title": "일반",
        "approx_rating": 1400,
        "skill": 8, "elo": 1320, "depth": 6, "movetime": 300, "randomness": 0.12,
        "blurb": "동네 대회에 나가는 키위. 실수를 가끔 합니다.",
        "avatar": "♟️",
    },
    5: {
        "level": 5, "name": "Kiwi CM", "title": "Candidate Master",
        "approx_rating": 1800,
        "skill": 12, "elo": 1700, "depth": 8, "movetime": 500, "randomness": 0.05,
        "blurb": "후보 마스터 키위. 어지간한 실수는 놓치지 않아요.",
        "avatar": "🎓",
    },
    6: {
        "level": 6, "name": "Kiwi IM", "title": "International Master",
        "approx_rating": 2200,
        "skill": 16, "elo": 2100, "depth": 12, "movetime": 800, "randomness": 0.0,
        "blurb": "국제 마스터 키위. 정교한 계산을 합니다.",
        "avatar": "🏅",
    },
    7: {
        "level": 7, "name": "Kiwi GM", "title": "Grandmaster",
        "approx_rating": 2500,
        "skill": 19, "elo": 2500, "depth": 16, "movetime": 1200, "randomness": 0.0,
        "blurb": "그랜드마스터 키위. 빈틈을 찾기 매우 어렵습니다.",
        "avatar": "👑",
    },
    8: {
        "level": 8, "name": "Kiwi Grandmaster", "title": "최고 난이도",
        "approx_rating": 3200,
        "skill": 20, "elo": None, "depth": 20, "movetime": 2000, "randomness": 0.0,
        "blurb": "전설의 키위. 풀 파워 Stockfish. 행운을 빕니다.",
        "avatar": "🦤",
    },
}


def get_bot(level: int) -> dict:
    return BOTS.get(level, BOTS[1])


def list_bots() -> list[dict]:
    return [BOTS[i] for i in sorted(BOTS.keys())]
