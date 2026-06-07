"""8단계 키위 봇 정의.

ELO는 실제 플레이 강도에 맞춰 보정한 추정치입니다. 낮은 레벨은 Skill Level을
낮추고 약간의 무작위성을 더해 사람과 비슷한 수준으로 약화시킵니다.
(과도한 무작위성으로 표기 ELO보다 약하게 두던 문제를 보정 — 무작위성 대폭 감소,
충분한 탐색 깊이 확보, 표기 ELO를 실제 강도에 맞게 하향 조정.)
프런트엔드 WASM 엔진과 백엔드 폴백 엔진이 공유합니다.
"""

# level: 1..8  (approx_rating = 보정된 실제 추정 ELO)
BOTS = {
    1: {
        "level": 1, "name": "Kiwi Baby", "title": "입문",
        "approx_rating": 350,
        "skill": 0, "elo": None, "depth": 5, "movetime": 200, "randomness": 0.40,
        "blurb": "이제 막 알을 깨고 나온 아기 키위. 가끔 엉뚱한 수를 둬요.",
        "avatar": "🥝",
    },
    2: {
        "level": 2, "name": "Kiwi Kid", "title": "초보",
        "approx_rating": 600,
        "skill": 2, "elo": None, "depth": 6, "movetime": 250, "randomness": 0.25,
        "blurb": "체스를 배우는 꼬마 키위. 기본기는 아직 부족해요.",
        "avatar": "🐣",
    },
    3: {
        "level": 3, "name": "Kiwi Student / Pupil", "title": "학생",
        "approx_rating": 900,
        "skill": 4, "elo": None, "depth": 7, "movetime": 300, "randomness": 0.12,
        "blurb": "정석을 공부하는 학생 키위. 전술을 조금씩 알아갑니다.",
        "avatar": "📘",
    },
    4: {
        "level": 4, "name": "Kiwi Player", "title": "일반",
        "approx_rating": 1200,
        "skill": 7, "elo": None, "depth": 8, "movetime": 400, "randomness": 0.05,
        "blurb": "동네 대회에 나가는 키위. 실수를 가끔 합니다.",
        "avatar": "♟️",
    },
    5: {
        "level": 5, "name": "Kiwi CM", "title": "Candidate Master",
        "approx_rating": 1550,
        "skill": 10, "elo": None, "depth": 10, "movetime": 600, "randomness": 0.0,
        "blurb": "후보 마스터 키위. 어지간한 실수는 놓치지 않아요.",
        "avatar": "🎓",
    },
    6: {
        "level": 6, "name": "Kiwi IM", "title": "International Master",
        "approx_rating": 1900,
        "skill": 14, "elo": None, "depth": 13, "movetime": 900, "randomness": 0.0,
        "blurb": "국제 마스터 키위. 정교한 계산을 합니다.",
        "avatar": "🏅",
    },
    7: {
        "level": 7, "name": "Kiwi GM", "title": "Grandmaster",
        "approx_rating": 2250,
        "skill": 18, "elo": None, "depth": 16, "movetime": 1200, "randomness": 0.0,
        "blurb": "그랜드마스터 키위. 빈틈을 찾기 매우 어렵습니다.",
        "avatar": "👑",
    },
    8: {
        "level": 8, "name": "Kiwi Grandmaster", "title": "최고 난이도",
        "approx_rating": 2700,
        "skill": 20, "elo": None, "depth": 20, "movetime": 2000, "randomness": 0.0,
        "blurb": "전설의 키위. 풀 파워 Stockfish. 행운을 빕니다.",
        "avatar": "🦤",
    },
}


def get_bot(level: int) -> dict:
    return BOTS.get(level, BOTS[1])


def list_bots() -> list[dict]:
    return [BOTS[i] for i in sorted(BOTS.keys())]
