"""스트릭(연속 활동 일수) 계산.

활동(퍼즐 풀이/대국 종료/접속)이 있을 때마다 호출하여
오늘 날짜 기준으로 연속 일수를 갱신한다.
"""
from datetime import date, timedelta


def _today() -> str:
    return date.today().isoformat()


def update_streak(user) -> dict:
    """user.streak_* 필드를 오늘 활동 기준으로 갱신. 변경된 값을 반환."""
    today = date.today()
    today_s = today.isoformat()
    last = user.streak_last or ""

    if last == today_s:
        # 오늘 이미 활동 → 변동 없음
        pass
    elif last == (today - timedelta(days=1)).isoformat():
        # 어제 활동 → 연속 +1
        user.streak_current = (user.streak_current or 0) + 1
        user.streak_last = today_s
    else:
        # 연속 끊김(또는 첫 활동) → 1부터 시작
        user.streak_current = 1
        user.streak_last = today_s

    if (user.streak_current or 0) > (user.streak_best or 0):
        user.streak_best = user.streak_current

    return {"current": user.streak_current, "best": user.streak_best}
