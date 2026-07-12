"""보안 계층: 레이트 리밋, 무차별 대입 방어, 봇/이상행위 감지, 입력 정화, 보안 헤더.

방어 대상
- 무차별 대입(brute force): 로그인/회원가입 실패 누적 시 지수적 지연 + 임시 잠금
- 요청 폭주(DoS/스팸): IP + 사용자 단위 토큰 버킷 레이트 리밋(경로 등급별)
- 봇/자동화: 비정상적으로 빠르거나 일정한 요청 간격, 비인간적 착수 속도 감지
- XSS: 저장 시점에 위험 문자/제어문자 제거(출력 시점 이스케이프는 프런트엔드가 담당)
- SQL Injection: ORM 파라미터 바인딩만 사용(원시 SQL 없음) + LIKE 와일드카드 이스케이프
- 클릭재킹/MIME 스니핑: 보안 응답 헤더
- 개인정보: 로그에 비밀번호/토큰을 남기지 않음, IP는 해시로만 저장
"""
from __future__ import annotations

import hashlib
import re
import time
import unicodedata
from collections import defaultdict, deque
from typing import Optional

from .config import settings

# ---------------------------------------------------------------------------
# 1) 레이트 리밋 (토큰 버킷, 인메모리)
# ---------------------------------------------------------------------------

# 경로 등급별 정책: (최대 요청 수, 기간(초))
RATE_POLICIES: dict[str, tuple[int, int]] = {
    "auth":     (10, 300),    # 로그인/회원가입: 5분에 10회
    "write":    (60, 60),     # 쓰기(프로필/친구/DM): 분당 60
    "dm":       (30, 60),     # DM: 분당 30
    "engine":   (120, 60),    # 봇 착수/분석: 분당 120
    "read":     (300, 60),    # 읽기: 분당 300
    "admin":    (120, 60),    # 관리자: 분당 120
}

# key -> deque[timestamp]
_buckets: dict[str, deque] = defaultdict(deque)


def _now() -> float:
    return time.time()


def hash_ip(ip: str) -> str:
    """IP 원문을 저장하지 않고 비밀키로 해시(개인정보 보호)."""
    return hashlib.sha256((settings.SECRET + "|" + (ip or "")).encode()).hexdigest()[:32]


def rate_check(key: str, policy: str) -> tuple[bool, int]:
    """허용 여부와 재시도까지 남은 초를 반환. (True, 0) 이면 통과."""
    limit, window = RATE_POLICIES.get(policy, RATE_POLICIES["read"])
    bucket = _buckets[f"{policy}:{key}"]
    now = _now()
    cutoff = now - window
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        retry_after = int(bucket[0] + window - now) + 1
        return False, max(1, retry_after)
    bucket.append(now)
    return True, 0


# ---------------------------------------------------------------------------
# 2) 무차별 대입 방어 (로그인 실패 누적 → 지수적 잠금)
# ---------------------------------------------------------------------------

# ip_hash|username -> (실패 횟수, 잠금 해제 시각)
_failures: dict[str, tuple[int, float]] = {}

MAX_FAILURES_BEFORE_LOCK = 5
LOCK_BASE_SECONDS = 30       # 5회 초과부터 30s, 60s, 120s ... 최대 30분
LOCK_MAX_SECONDS = 1800


def _fail_key(ip_hash: str, username: str) -> str:
    return f"{ip_hash}|{(username or '').lower()}"


def login_locked(ip_hash: str, username: str) -> int:
    """잠금 중이면 남은 초, 아니면 0."""
    rec = _failures.get(_fail_key(ip_hash, username))
    if not rec:
        return 0
    _, until = rec
    remain = int(until - _now())
    return remain if remain > 0 else 0


def record_login_failure(ip_hash: str, username: str) -> int:
    """실패 기록. 잠금이 걸리면 잠금 초를 반환(아니면 0)."""
    key = _fail_key(ip_hash, username)
    count, _ = _failures.get(key, (0, 0.0))
    count += 1
    lock_for = 0
    if count > MAX_FAILURES_BEFORE_LOCK:
        over = count - MAX_FAILURES_BEFORE_LOCK
        lock_for = min(LOCK_BASE_SECONDS * (2 ** (over - 1)), LOCK_MAX_SECONDS)
    _failures[key] = (count, _now() + lock_for)
    return lock_for


def clear_login_failures(ip_hash: str, username: str) -> None:
    _failures.pop(_fail_key(ip_hash, username), None)


# ---------------------------------------------------------------------------
# 3) 봇 / 이상행위 감지
# ---------------------------------------------------------------------------

# user_id -> deque[요청 시각]  (최근 N개만 유지)
_activity: dict[int, deque] = defaultdict(lambda: deque(maxlen=40))
# user_id -> 누적 의심 점수
_suspicion: dict[int, float] = defaultdict(float)

# 사람이라면 나오기 힘든 값들
MIN_HUMAN_INTERVAL = 0.06     # 60ms 미만 연속 요청 = 자동화 의심
ROBOTIC_STDDEV = 0.012        # 간격 표준편차가 12ms 미만이면 기계적 반복


def note_activity(user_id: Optional[int]) -> None:
    if not user_id:
        return
    _activity[user_id].append(_now())


def _stddev(values: list[float]) -> float:
    if len(values) < 2:
        return 1.0
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / (len(values) - 1)
    return var ** 0.5


def bot_score(user_id: Optional[int]) -> float:
    """0.0(사람) ~ 1.0(봇 확실). 최근 요청 간격 패턴으로 추정."""
    if not user_id:
        return 0.0
    times = list(_activity.get(user_id, []))
    if len(times) < 12:
        return 0.0
    gaps = [times[i] - times[i - 1] for i in range(1, len(times))]
    score = 0.0
    # (a) 비인간적으로 빠른 연속 요청 비율
    too_fast = sum(1 for g in gaps if g < MIN_HUMAN_INTERVAL) / len(gaps)
    score += min(0.6, too_fast * 1.2)
    # (b) 간격이 기계처럼 일정한가
    if _stddev(gaps) < ROBOTIC_STDDEV:
        score += 0.4
    return min(1.0, score)


def add_suspicion(user_id: Optional[int], amount: float) -> float:
    if not user_id:
        return 0.0
    _suspicion[user_id] += amount
    return _suspicion[user_id]


def get_suspicion(user_id: Optional[int]) -> float:
    return _suspicion.get(user_id, 0.0) if user_id else 0.0


def reset_suspicion(user_id: int) -> None:
    _suspicion.pop(user_id, None)
    _activity.pop(user_id, None)


# ---------------------------------------------------------------------------
# 4) 입력 정화 (XSS 저장 방지 / 제어문자 제거)
# ---------------------------------------------------------------------------

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 스크립트 삽입에 흔히 쓰이는 패턴 (저장 자체를 막는다)
_DANGEROUS_RE = re.compile(
    r"(<\s*script|javascript\s*:|data\s*:\s*text/html|on\w+\s*=|<\s*iframe|<\s*object|<\s*embed)",
    re.IGNORECASE,
)


def sanitize_text(value: Optional[str], max_len: int = 200, allow_newlines: bool = False) -> str:
    """저장용 텍스트 정화: 유니코드 정규화 → 제어문자 제거 → 위험 태그 무력화 → 길이 제한.

    HTML 을 허용하지 않는 필드 전용(닉네임/위치/자기소개 등).
    출력 시점에도 프런트엔드가 반드시 이스케이프한다(이중 방어).
    """
    if not value:
        return ""
    s = unicodedata.normalize("NFKC", str(value))
    s = _CONTROL_RE.sub("", s)
    if not allow_newlines:
        s = s.replace("\n", " ").replace("\r", " ")
    else:
        s = s.replace("\r\n", "\n").replace("\r", "\n")
    # 위험 패턴은 꺾쇠를 제거해 무력화 (내용은 보존)
    if _DANGEROUS_RE.search(s):
        s = s.replace("<", "").replace(">", "")
    s = s.strip()
    return s[:max_len]


def escape_like(value: str) -> str:
    """LIKE/ILIKE 와일드카드 이스케이프 (검색어의 % _ 남용 방지)."""
    if not value:
        return ""
    return (
        value.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def is_weak_password(password: str) -> bool:
    """아주 흔한 비밀번호 차단."""
    common = {
        "123456", "password", "123456789", "12345678", "qwerty", "abc123",
        "111111", "1234567", "12345", "iloveyou", "000000", "qwerty123",
        "asdfgh", "chess123", "password1", "1q2w3e4r", "letmein",
    }
    return password.lower() in common


# ---------------------------------------------------------------------------
# 5) 보안 응답 헤더
# ---------------------------------------------------------------------------

# 우리 프런트엔드는 인라인 <script> 를 쓰지 않지만, 인라인 onclick/style 이 일부 있어
# 'unsafe-inline' 을 script 에는 주지 않고 style 에만 허용한다.
# Stockfish WASM 워커를 위해 worker-src/'wasm-unsafe-eval' 허용.
CSP = (
    "default-src 'self'; "
    "script-src 'self' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "connect-src 'self' ws: wss:; "
    "font-src 'self' data:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def policy_for_path(method: str, path: str) -> str:
    """경로 → 레이트 리밋 등급."""
    if path.startswith("/api/login") or path.startswith("/api/register"):
        return "auth"
    if path.startswith("/api/admin"):
        return "admin"
    if path.startswith("/api/friends/dm"):
        return "dm"
    if path.startswith("/api/bot/move") or path.startswith("/api/analysis"):
        return "engine"
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        return "write"
    return "read"


# ---------------------------------------------------------------------------
# 6) 청소부 — 인메모리 저장소가 무한히 커지지 않도록 주기적으로 정리
# ---------------------------------------------------------------------------

_last_cleanup = 0.0
CLEANUP_INTERVAL = 300          # 5분마다
ACTIVITY_STALE_SECONDS = 1800   # 30분간 활동 없으면 추적 해제


def cleanup(force: bool = False) -> dict:
    """만료된 레이트리밋 버킷 / 잠금 해제된 실패 기록 / 오래된 활동 추적을 제거."""
    global _last_cleanup
    now = _now()
    if not force and now - _last_cleanup < CLEANUP_INTERVAL:
        return {}
    _last_cleanup = now

    removed = {"buckets": 0, "failures": 0, "activity": 0, "suspicion": 0}

    # 레이트리밋 버킷: 기간이 지나 비워진 키 제거
    for key in list(_buckets.keys()):
        policy = key.split(":", 1)[0]
        _limit, window = RATE_POLICIES.get(policy, RATE_POLICIES["read"])
        bucket = _buckets[key]
        cutoff = now - window
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if not bucket:
            del _buckets[key]
            removed["buckets"] += 1

    # 로그인 실패: 잠금이 풀렸고 마지막 실패로부터 충분히 지난 항목 제거
    for key in list(_failures.keys()):
        _count, until = _failures[key]
        if until < now - LOCK_MAX_SECONDS:
            del _failures[key]
            removed["failures"] += 1

    # 활동 추적: 오래 조용한 사용자 제거
    for uid in list(_activity.keys()):
        times = _activity[uid]
        if not times or (now - times[-1]) > ACTIVITY_STALE_SECONDS:
            del _activity[uid]
            removed["activity"] += 1
            # 의심 점수도 활동이 끊기면 함께 정리(단, 높은 점수는 보존)
            if _suspicion.get(uid, 0) < 5:
                _suspicion.pop(uid, None)
                removed["suspicion"] += 1

    return removed


def store_sizes() -> dict:
    """관리자 진단용: 인메모리 저장소 크기."""
    return {
        "buckets": len(_buckets),
        "failures": len(_failures),
        "activity": len(_activity),
        "suspicion": len(_suspicion),
    }
